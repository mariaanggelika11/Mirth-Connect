/** Disabled filters retain their exact rule in the existing filter_script column.
 * The wrapper is also a no-op for older sandbox runtimes; it never executes the retained rule.
 */
const prefix = '/* MIRTH_SOURCE_FILTER_DISABLED_V1:';
const suffix = ' */\nreturn true;';
export function writeSourceFilter(rule: string, enabled: boolean): string {
  if (enabled || !rule.trim()) return rule;
  const result = `${prefix}${encodeURIComponent(rule)}${suffix}`;
  if (result.length > 65536)
    throw new Error('This retained filter exceeds the storage limit. Shorten it before disabling.');
  return result;
}
export function readSourceFilter(script = ''): { enabled: boolean; rule: string } {
  if (!script.startsWith(prefix)) return { enabled: !!script.trim(), rule: script };
  try {
    if (!script.endsWith(suffix)) throw new Error();
    const rule = decodeURIComponent(script.slice(prefix.length, -suffix.length));
    if (writeSourceFilter(rule, false) !== script || rule.startsWith(prefix)) throw new Error();
    return { enabled: false, rule };
  } catch {
    throw new Error('Invalid retained source filter configuration.');
  }
}
