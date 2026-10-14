import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const document = JSON.parse(
  await readFile(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'),
);
assert.equal(document.openapi, '3.1.0');
const operations = new Set();
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
for (const [path, item] of Object.entries(document.paths)) {
  for (const method of methods) {
    if (!item[method]) continue;
    const operation = item[method];
    assert.ok(
      operation.operationId && !operations.has(operation.operationId),
      'Missing/duplicate operation ID',
    );
    operations.add(operation.operationId);
    assert.ok(operation.responses && Object.keys(operation.responses).length);
    for (const match of path.matchAll(/\{(\w+)\}/g))
      assert.ok(
        [...(item.parameters || []), ...(operation.parameters || [])].some(
          (p) => p.in === 'path' && p.name === match[1] && p.required === true,
        ),
        'Missing path parameter',
      );
  }
}
function refs(value) {
  if (!value || typeof value !== 'object') return;
  if ('$ref' in value) {
    assert.ok(value.$ref.startsWith('#/'), 'Only local OpenAPI references are permitted');
    let target = document;
    for (const segment of value.$ref.slice(2).split('/'))
      target = target?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
    assert.ok(target, 'Unresolved OpenAPI reference');
  }
  for (const child of Object.values(value)) refs(child);
}
refs(document);
console.log(
  `PASS: OpenAPI 3.1 structure, local references, ${Object.keys(document.paths).length} paths and ${operations.size} unique operations. Semantic contract review remains required.`,
);
