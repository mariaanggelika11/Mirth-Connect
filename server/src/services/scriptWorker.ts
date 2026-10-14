import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';
import { parseField, buildField, escapeField } from '../utils/hl7Fields.js';
import { delimiters, parseSegments, hl7ToJson, jsonToHl7 } from '../utils/hl7Converer.js';
async function run() {
  const { script, context, resultVariable, timeout, memoryMb } = workerData;
  const module = await getQuickJS();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(memoryMb * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + timeout;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    // Only JSON values cross the boundary. Helpers execute INSIDE QuickJS, with no host callbacks.
    const helpers = `class AppError extends Error { constructor(status, code, message) { super(code); } }\n${parseField.toString()}\n${escapeField.toString()}\n${buildField.toString()}\n${delimiters.toString()}\n${parseSegments.toString()}\n${hl7ToJson.toString()}\n${jsonToHl7.toString()}`;
    const vars = Object.entries(context as Record<string, unknown>)
      .map(([k, v]) => `var ${k}=JSON.parse(${JSON.stringify(JSON.stringify(v ?? null))});`)
      .join('\n');
    const evaluated = vm.evalCode(
      `${helpers}\n${vars}\n(function(){const value=(function(){${script}\nreturn ${resultVariable};})(); if(value && typeof value.then === 'function') throw new Error('SCRIPT_ASYNC_UNSUPPORTED'); return JSON.stringify(value);})();`,
    );
    if (evaluated.error) {
      // Reserve diagnostic headroom only after evaluation has failed. Never dump a user
      // exception object (its getters/toJSON could execute code or contain payload).
      runtime.setMemoryLimit(memoryMb * 1024 * 1024 + 1024 * 1024);
      const nameHandle = vm.getProp(evaluated.error, 'name');
      const messageHandle = vm.getProp(evaluated.error, 'message');
      const failure = { name: vm.getString(nameHandle), message: vm.getString(messageHandle) };
      nameHandle.dispose();
      messageHandle.dispose();
      evaluated.error.dispose();
      // Inspect inside this worker; never send user script exception text across the boundary.
      const code =
        failure?.name === 'InternalError' && failure?.message === 'interrupted'
          ? 'SCRIPT_TIMEOUT'
          : failure?.name === 'InternalError' && failure?.message === 'out of memory'
            ? 'SCRIPT_MEMORY_LIMIT'
            : 'SCRIPT_EXECUTION_FAILED';
      parentPort?.postMessage({ success: false, code });
      return;
    }
    const encoded = vm.getString(evaluated.value);
    evaluated.value.dispose();
    if (!encoded || Buffer.byteLength(encoded) > workerData.maxBytes)
      throw new Error('SCRIPT_RESULT_INVALID');
    parentPort?.postMessage({ success: true, value: JSON.parse(encoded) });
  } catch {
    parentPort?.postMessage({ success: false });
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
void run().catch(() => parentPort?.postMessage({ success: false }));
