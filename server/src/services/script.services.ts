import { Worker } from 'node:worker_threads';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';
let active = 0;
export async function executeScript(
  script: string,
  context: { msg: unknown; response?: unknown },
  resultVariable: 'msg' | 'response' | 'true' = 'msg',
): Promise<unknown> {
  if (active >= config.scripts.concurrency)
    throw new AppError(503, 'SCRIPT_CAPACITY', 'Script execution capacity exceeded');
  if (
    script.length > 65536 ||
    Buffer.byteLength(JSON.stringify(context)) > config.server.payloadLimit
  )
    throw new AppError(413, 'SCRIPT_INPUT_LIMIT', 'Script input limit exceeded');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      // tsx loader is needed only for development. Production always uses compiled JS.
      const isTs = import.meta.url.endsWith('.ts');
      const target = new URL('./scriptWorker.' + (isTs ? 'ts' : 'js'), import.meta.url);
      const worker = isTs
        ? new Worker(
            `import("tsx/esm/api").then(({tsImport})=>tsImport(${JSON.stringify(target.href)},${JSON.stringify(import.meta.url)}))`,
            {
              eval: true,
              execArgv: [],
              workerData: {
                script,
                context,
                resultVariable,
                ...config.scripts,
                maxBytes: config.server.payloadLimit,
              },
              resourceLimits: { maxOldGenerationSizeMb: 64 },
            },
          )
        : new Worker(target, {
            execArgv: [],
            workerData: {
              script,
              context,
              resultVariable,
              ...config.scripts,
              maxBytes: config.server.payloadLimit,
            },
            resourceLimits: { maxOldGenerationSizeMb: 64 },
          });
      let done = false;
      const finish = (error?: Error, value?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(
        () => finish(new AppError(422, 'SCRIPT_TIMEOUT', 'Script execution timed out')),
        config.scripts.timeout + 1000,
      );
      worker.once('message', (result) => {
        if (result.success && resultVariable === 'true' && typeof result.value !== 'boolean')
          return finish(new AppError(422, 'FILTER_RESULT_INVALID', 'Filter must return a boolean'));
        finish(
          result.success
            ? undefined
            : new AppError(422, 'SCRIPT_EXECUTION_FAILED', 'Script execution failed'),
          result.value,
        );
      });
      worker.once('error', () =>
        finish(new AppError(422, 'SCRIPT_WORKER_FAILED', 'Script worker failed')),
      );
      worker.once('exit', () => {
        if (!done) finish(new AppError(422, 'SCRIPT_WORKER_EXIT', 'Script worker exited'));
      });
    });
  } finally {
    active--;
  }
}
