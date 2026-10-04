import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';
import { parseField, buildField } from '../utils/hl7Fields.js';
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
    const helpers = `class AppError extends Error { constructor(status, code, message) { super(code); } }\n${parseField.toString()}\n${buildField.toString()}\n${delimiters.toString()}\n${parseSegments.toString()}\n${hl7ToJson.toString()}\n${jsonToHl7.toString()}`;
    const vars = Object.entries(context as Record<string, unknown>)
      .map(([k, v]) => `var ${k}=JSON.parse(${JSON.stringify(JSON.stringify(v ?? null))});`)
      .join('\n');
    const evaluated = vm.evalCode(
      `${helpers}\n${vars}\nJSON.stringify((function(){${script}\nreturn ${resultVariable};})());`,
    );
    if (evaluated.error) {
      evaluated.error.dispose();
      throw new Error('SCRIPT_EXECUTION_FAILED');
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
