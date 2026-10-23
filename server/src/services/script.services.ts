import { increment, gauge } from '../utils/runtimeMetrics.js';
import { Worker } from 'node:worker_threads';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { readFieldMapping, validFieldMappingScript } from '../utils/fieldMapping.js';
import { readRetainedFilter } from '../utils/sourceFilter.js';
import { readSimpleCondition } from '../utils/simpleCondition.js';
import { Parser } from 'xml2js';
import { randomUUID } from 'node:crypto';
import { hl7ToJson } from '../utils/hl7Converer.js';
import { describeHl7Field, hl7TargetFields } from '../utils/hl7Configuration.js';
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
      const filter = readRetainedFilter(script);
      if (filter.rule.startsWith('/* MIRTH_SIMPLE_CONDITION_') && !readSimpleCondition(filter.rule))
        throw new Error('Invalid generated condition');
      if (!filter.enabled) return true;
      // Legacy literal booleans represent filter decisions, not fall-through to return true.
      const literal = /^(true|false)\s*;?$/.exec(script.trim());
      if (literal) return literal[1] === 'true';
    } catch {
      throw new AppError(422, 'FILTER_CONFIG_INVALID', 'Invalid filter configuration');
    }
  }
  if (active >= config.scripts.concurrency)
    throw new AppError(503, 'SCRIPT_CAPACITY', 'Script execution capacity exceeded');

  active++;
  gauge('script_workers_active', active);
  try {
    const mapping = readFieldMapping(script);
    if (!mapping && !validFieldMappingScript(script))
      throw new AppError(
        422,
        'FIELD_MAPPING_CONFIG_INVALID',
        'The generated mapping has been changed. Restore its field mappings or replace it with a complete custom transformation script.',
      );
    if (
      mapping?.version === 2 &&
      typeof context.msg === 'string' &&
      context.msg.trim().startsWith('MSH')
    ) {
      try {
        context = { ...context, msg: hl7ToJson(context.msg.trim()) };
      } catch {
        throw new AppError(
          422,
          'FIELD_MAPPING_INPUT_INVALID',
          'The source is not valid HL7. Check its MSH header and delimiters.',
        );
      }
    }
    // Visual mappings/filters normalize XML before entering the existing isolated worker.
    // Legacy/custom scripts continue to receive their original input unchanged.
    if (
      (mapping || readSimpleCondition(script)) &&
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
    const workerContext =
      mapping?.version === 2
        ? {
            ...context,
            mappingRuntime: {
              timestamp: new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '+0000',
              controlId: randomUUID(),
            },
          }
        : context;
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
                context: workerContext,
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
              context: workerContext,
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
        if (result.success && mapping?.version === 2) {
          const envelope = result.value;
          if (
            !envelope ||
            typeof envelope !== 'object' ||
            envelope.kind !== 'MIRTH_MAPPING_V2_RESULT' ||
            typeof envelope.success !== 'boolean'
          )
            return finish(
              new AppError(
                422,
                'FIELD_MAPPING_RESULT_INVALID',
                'The mapping did not produce a valid result.',
              ),
            );
          if (envelope.success) {
            if (resultVariable === 'true' && typeof envelope.value !== 'boolean')
              return finish(
                new AppError(422, 'FILTER_RESULT_INVALID', 'Filter must return a boolean'),
              );
            return finish(undefined, envelope.value);
          }
          const row =
            Number.isInteger(envelope.index) && envelope.index >= 0
              ? mapping.rows[envelope.index]
              : undefined;
          const field =
            mapping.hl7 &&
            typeof envelope.field === 'string' &&
            hl7TargetFields(mapping.hl7.messageType).some((item) => item.path === envelope.field)
              ? envelope.field
              : undefined;
          let code = 'FIELD_MAPPING_FAILED',
            message = 'Check the mapping source fields, target fields and type conversions.';
          if (envelope.code === 'FIELD_MAPPING_REQUIRED' && row) {
            code = envelope.code;
            message = `Source path ${row.source} is missing or empty for target ${row.target}.`;
          }
          if (envelope.code === 'FIELD_MAPPING_CONVERSION' && row) {
            code = envelope.code;
            message = `Mapping ${envelope.index + 1}: ${row.source} cannot be converted for ${row.target}. ${row.conversion === 'DATE_TO_HL7' ? 'Expected YYYY-MM-DD.' : row.conversion === 'DATE_FROM_HL7' ? 'Expected YYYYMMDD.' : 'Check the selected type conversion.'}`;
          }
          if (envelope.code === 'FIELD_MAPPING_INPUT_INVALID') {
            code = envelope.code;
            message = 'Use a structured JSON, XML or HL7 message for field mapping.';
          }
          if (envelope.code === 'FIELD_MAPPING_TARGET') {
            code = envelope.code;
            message = 'Mapping targets overlap or conflict with the selected output structure.';
          }
          if (
            field &&
            [
              'HL7_PROFILE_REQUIRED',
              'HL7_PROFILE_DATE',
              'HL7_PROFILE_CODE',
              'HL7_PROFILE_IDENTIFIER',
            ].includes(envelope.code)
          ) {
            code = envelope.code;
            const label = `${field.replace('.', '-')} (${describeHl7Field(field) || 'HL7 field'})`;
            message =
              envelope.code === 'HL7_PROFILE_REQUIRED'
                ? `${label} is required by the selected template.`
                : envelope.code === 'HL7_PROFILE_DATE'
                  ? `${label} must be a valid date in ${field === 'PID.7' ? 'YYYYMMDD' : 'YYYYMMDDHHmmss with optional +/-HHMM offset'} format.`
                  : envelope.code === 'HL7_PROFILE_IDENTIFIER'
                    ? `${label} must contain a valid, consistent identifier.`
                    : `${label} contains a code unsupported by this curated template.`;
          }
          return finish(new AppError(422, code, message));
        }
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
