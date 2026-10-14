const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, { count: number; sum: number; buckets: number[] }>();
const bounds = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 120];
// Metric names are passed only by source code; no patient/channel/name/request labels are accepted.
export function increment(name: string, amount = 1) {
  counters.set(name, (counters.get(name) || 0) + amount);
}
export function gauge(name: string, value: number) {
  gauges.set(name, Number.isFinite(value) ? value : 0);
}
export function observe(name: string, seconds: number) {
  const h = histograms.get(name) || { count: 0, sum: 0, buckets: bounds.map(() => 0) };
  h.count++;
  h.sum += seconds;
  bounds.forEach((b, i) => {
    if (seconds <= b) h.buckets[i]++;
  });
  histograms.set(name, h);
}
export function renderRuntimeMetrics() {
  const lines = [...counters].map(
    ([name, value]) => `# TYPE mirth_${name} counter\nmirth_${name} ${value}`,
  );
  for (const [name, value] of gauges)
    lines.push(`# TYPE mirth_${name} gauge\nmirth_${name} ${value}`);
  for (const [name, h] of histograms) {
    lines.push(`# TYPE mirth_${name} histogram`);
    bounds.forEach((b, i) => lines.push(`mirth_${name}_bucket{le="${b}"} ${h.buckets[i]}`));
    lines.push(
      `mirth_${name}_bucket{le="+Inf"} ${h.count}`,
      `mirth_${name}_count ${h.count}`,
      `mirth_${name}_sum ${h.sum}`,
    );
  }
  return lines.join('\n') + '\n';
}
