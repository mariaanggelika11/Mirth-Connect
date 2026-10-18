import { increment, gauge } from '../utils/runtimeMetrics.js';
import { Worker } from 'node:worker_threads';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { readFieldMapping } from '../utils/fieldMapping.js';
import { readSourceFilter } from '../utils/sourceFilter.js';
import { readSimpleCondition } from '../utils/simpleCondition.js';
import { Parser } from 'xml2js';
let active = 0;
export async function executeScript(
  script: string,
  context: { msg: unknown; response?: unknown },
  resultVariable: 'msg' | 'response' | 'true' = 'msg',
): Promise<unknown> {
  if (
    script.length > 65536 ||
    Buffer.byteLength(JSON.stringify(context)) > config.server.payloadLimit
  )
    throw new AppError(413, 'SCRIPT_INPUT_LIMIT', 'Script input limit exceeded');
  if (resultVariable === 'true') {
    try {
      const filter = readSourceFilter(script);
      if (filter.rule.startsWith('/* MIRTH_SIMPLE_CONDITION_') && !readSimpleCondition(filter.rule))
        throw new Error('Invalid generated condition');
      if (!filter.enabled) return true;
    } catch {
      throw new AppError(422, 'FILTER_CONFIG_INVALID', 'Invalid source filter configuration');
    }
  }
  if (active >= config.scripts.concurrency)
    throw new AppError(503, 'SCRIPT_CAPACITY', 'Script execution capacity exceeded');

  active++;
  gauge('script_workers_active', active);
  try {
    // Visual mappings/filters normalize XML before entering the existing isolated worker.
    // Legacy/custom scripts continue to receive their original input unchanged.
    if (
      (readFieldMapping(script) || readSimpleCondition(script)) &&
      typeof context.msg === 'string' &&
      context.msg.trim().startsWith('<')
    ) {
      if (/<!DOCTYPE|<!ENTITY/i.test(context.msg))
        throw new AppError(422, 'XML_ENTITIES_DENIED', 'XML entity declarations are not supported');
      try {
        let nodes = 0;
        context = {
          ...context,
          msg: await new Parser({
            strict: true,
            explicitRoot: true,
            explicitArray: false,
            async: true,
            chunkSize: 8192,
            validator: (path: string, _old: unknown, value: unknown) => {
              if (++nodes > 20000 || path.split('/').length > 65)
                throw new Error('XML_MAPPING_LIMIT');
              return value;
            },
          }).parseStringPromise(context.msg),
        };
      } catch {
        throw new AppError(
          422,
          readSimpleCondition(script) ? 'FILTER_INPUT_INVALID' : 'FIELD_MAPPING_INPUT_INVALID',
          'Invalid XML processing input',
        );
      }
      if (Buffer.byteLength(JSON.stringify(context)) > config.server.payloadLimit)
        throw new AppError(413, 'SCRIPT_INPUT_LIMIT', 'Script input limit exceeded');
    }
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
        if (error) {
          increment('script_failures_total');
          if (error instanceof AppError && error.code === 'SCRIPT_TIMEOUT')
            increment('script_timeouts_total');
          if (error instanceof AppError && error.code === 'SCRIPT_MEMORY_LIMIT')
            increment('script_memory_failures_total');
          reject(error);
        } else resolve(value);
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
            : new AppError(
                422,
                ['SCRIPT_TIMEOUT', 'SCRIPT_MEMORY_LIMIT'].includes(result.code)
                  ? result.code
                  : resultVariable === 'true' && readSimpleCondition(script)
                    ? 'FILTER_INPUT_INVALID'
                    : 'SCRIPT_EXECUTION_FAILED',
                'Script execution failed',
              ),
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
    gauge('script_workers_active', active);
  }
}
