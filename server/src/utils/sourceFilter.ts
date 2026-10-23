import { readSimpleCondition } from './simpleCondition.js';
/** Source and destination filters share the same retained-rule storage contract.
 * Wrappers contain data in a comment and a no-op boolean body for older runtimes.
 */
const sourcePrefix = '/* MIRTH_SOURCE_FILTER_DISABLED_V1:';
const destinationPrefix = '/* MIRTH_DESTINATION_FILTER_DISABLED_V1:';
const suffix = ' */\nreturn true;';
function write(rule: string, enabled: boolean, prefix: string): string {
  if (enabled || !rule.trim()) return rule;
  const result = `${prefix}${encodeURIComponent(rule)}${suffix}`;
  if (result.length > 65536)
    throw new Error('This retained filter exceeds the storage limit. Shorten it before disabling.');
  return result;
}
function read(script: string, prefix: string): { enabled: boolean; rule: string } {
  if (!script.startsWith(prefix)) return { enabled: !!script.trim(), rule: script };
  try {
    if (!script.endsWith(suffix)) throw new Error();
    const rule = decodeURIComponent(script.slice(prefix.length, -suffix.length));
    if (
      write(rule, false, prefix) !== script ||
      rule.startsWith(sourcePrefix) ||
      rule.startsWith(destinationPrefix)
    )
      throw new Error();
    return { enabled: false, rule };
  } catch {
    throw new Error('Invalid retained filter configuration.');
  }
}
export function writeSourceFilter(rule: string, enabled: boolean): string {
  return write(rule, enabled, sourcePrefix);
}
export function readSourceFilter(script = ''): { enabled: boolean; rule: string } {
  if (script.startsWith(destinationPrefix))
    throw new Error('Invalid retained source filter configuration.');
  return read(script, sourcePrefix);
}
export function writeDestinationFilter(rule: string, enabled: boolean): string {
  return write(rule, enabled, destinationPrefix);
}
export function readDestinationFilter(script = ''): { enabled: boolean; rule: string } {
  // Older API clients could already use a source no-op wrapper in destination.filterScript.
  return read(script, script.startsWith(sourcePrefix) ? sourcePrefix : destinationPrefix);
}
export function readRetainedFilter(script = ''): { enabled: boolean; rule: string } {
  return readDestinationFilter(script);
}
export function validFilterConfiguration(script: string, kind: 'source' | 'destination'): boolean {
  try {
    const filter = kind === 'source' ? readSourceFilter(script) : readDestinationFilter(script);
    return (
      !filter.rule.startsWith('/* MIRTH_SIMPLE_CONDITION_') || !!readSimpleCondition(filter.rule)
    );
  } catch {
    return false;
  }
}
