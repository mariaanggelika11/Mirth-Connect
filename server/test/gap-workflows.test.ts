import { describe, it, expect } from 'vitest';
import { canonicalJson, requestDigest } from '../src/utils/idempotency.js';
import { channelSchema, draftPatchSchema } from '../src/utils/validator.js';
import { patchDraft } from '../src/services/revision.services.js';
import {
  validatePayload,
  validateProfileConfiguration,
} from '../src/services/profileValidation.services.js';
import { executeScript } from '../src/services/script.services.js';
import { renderRuntimeMetrics, gauge } from '../src/utils/runtimeMetrics.js';
import { config } from '../src/config/env.js';

describe('Canonical JSON and legacy wire identity', () => {
  it('equivalent nested objects retain identity while changed arrays and values conflict', () => {
    const first = { z: 1, a: { second: 2, first: [{ y: 'synthetic', x: null }] } };
    const reordered = { a: { first: [{ x: null, y: 'synthetic' }], second: 2 }, z: 1 };
    expect(requestDigest(first, true)).toBe(requestDigest(reordered, true));
    expect(requestDigest([1, 2], true)).not.toBe(requestDigest([2, 1], true));
    expect(requestDigest({ value: 1 }, true)).not.toBe(requestDigest({ value: '1' }, true));
    expect(canonicalJson(JSON.parse('{"__proto__":"synthetic","2":2,"10":10}'))).toBe(
      '{"10":10,"2":2,"__proto__":"synthetic"}',
    );
  });
  it('keeps JSON semantics for numbers, undefined and unicode without mutating input', () => {
    const value = { unicode: 'Pasien sintetis 日本', missing: undefined, number: -0 };
    expect(canonicalJson(value)).toBe('{"number":0,"unicode":"Pasien sintetis 日本"}');
    expect(Object.keys(value)).toContain('missing');
    expect(requestDigest('MSH|synthetic', false)).toBe(requestDigest('MSH|synthetic', true));
  });
  it('rejects deeply nested JSON before canonicalization can exhaust the stack', () => {
    expect(() => canonicalJson(JSON.parse('{"a":'.repeat(102) + '0' + '}'.repeat(102)))).toThrow(
      'depth limit',
    );
  });
});
describe('Secret-preserving draft iteration', () => {
  const configuration = channelSchema.parse({
    name: 'Synthetic draft',
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    processingScript: 'msg.synthetic = true;',
    validationProfile: { script: 'return true;' },
    destinations: [
      {
        name: 'Synthetic sender',
        type: 'REST',
        endpoint: 'http://user:synthetic-password@localhost/path?token=synthetic-key',
        processingScript: 'msg.fixture = "synthetic";',
        deliveryPolicy: { failureThreshold: 2 },
      },
    ],
  });
  it('changes public fields and preserves credential-bearing endpoint and all scripts', () => {
    const parsed = draftPatchSchema.parse({
      expectedChecksum: 'a'.repeat(64),
      changeSummary: 'Synthetic patch',
      patch: {
        name: 'Edited draft',
        destinations: [{ index: 0, isEnabled: false, timeoutMs: 1234 }],
      },
    });
    const changed = patchDraft(configuration, parsed.patch);
    expect(changed.destinations[0].endpoint).toBe(configuration.destinations[0].endpoint);
    expect(changed.processingScript).toBe(configuration.processingScript);
    expect(changed.validationProfile.script).toBe(configuration.validationProfile.script);
    expect(changed.destinations[0].processingScript).toBe(
      configuration.destinations[0].processingScript,
    );
    expect(changed.destinations[0].timeoutMs).toBe(1234);
    expect(changed.destinations[0].deliveryPolicy).toEqual({ failureThreshold: 2 });
    expect(configuration.destinations[0].isEnabled).toBe(true);
  });
  it('rejects missing/duplicate indices and unauthorized credential or script replacement', () => {
    expect(() => patchDraft(configuration, { destinations: [{ index: 1 }] })).toThrow();
    expect(() =>
      patchDraft(configuration, { destinations: [{ index: 0 }, { index: 0 }] }),
    ).toThrow();
    for (const patch of [
      { processingScript: 'secret' },
      { destinations: [{ index: 0, endpoint: 'http://localhost' }] },
      {},
    ])
      expect(
        draftPatchSchema.safeParse({
          expectedChecksum: 'a'.repeat(64),
          changeSummary: 'Synthetic change',
          patch,
        }).success,
      ).toBe(false);
  });
});
describe('Bounded cross-platform XML profile rules', () => {
  const xml = '<Order><ID>SYNTHETIC-001</ID><Status>NEW</Status><Status>NEW</Status></Order>';
  const profile = {
    xml: {
      root: 'Order',
      requiredPaths: ['Order.ID'],
      values: [{ path: 'Order.Status', allowed: ['NEW', 'UPDATED'] }],
    },
  };
  it('validates required text, allowed repeated values and declared root', async () => {
    validateProfileConfiguration(profile);
    await expect(validatePayload(xml, 'XML', profile)).resolves.toBeUndefined();
    await expect(
      validatePayload(xml.replace('SYNTHETIC-001', ''), 'XML', profile),
    ).rejects.toMatchObject({ code: 'XML_PROFILE_REJECTED' });
    await expect(
      validatePayload(
        xml.replace('<Status>NEW</Status>', '<Status>INVALID</Status>'),
        'XML',
        profile,
      ),
    ).rejects.toMatchObject({ code: 'XML_PROFILE_REJECTED' });
    await expect(validatePayload(xml, 'XML', { xml: { root: 'Different' } })).rejects.toMatchObject(
      { code: 'XML_PROFILE_REJECTED' },
    );
    await expect(
      validatePayload(xml, 'XML', {
        xml: { values: [{ path: 'Order.Absent', allowed: ['NEW'] }] },
      }),
    ).rejects.toMatchObject({ code: 'XML_PROFILE_REJECTED' });
  });
  it('rejects malformed XML, declarations and structural/path limits without exposing values', async () => {
    for (const value of [
      '',
      '<Order><ID>synthetic</Order>',
      '<A>'.repeat(70) + 'synthetic' + '</A>'.repeat(70),
      '<A>' + '<B/>'.repeat(20001) + '</A>',
    ])
      await expect(validatePayload(value, 'XML')).rejects.toMatchObject({ code: 'XML_INVALID' });
    await expect(
      validatePayload(
        '<!DOCTYPE A [<!ENTITY secret SYSTEM "file:///etc/passwd">]><A>&secret;</A>',
        'XML',
      ),
    ).rejects.toMatchObject({ code: 'XML_ENTITIES_DENIED' });
    expect(() => validateProfileConfiguration({ xml: { requiredPaths: ['Order.*'] } })).toThrow(
      'Invalid XML profile',
    );
  });
  it('supports literal namespace-prefixed names and attributes without XPath evaluation', async () => {
    await expect(
      validatePayload(
        '<h:Order xmlns:h="urn:synthetic"><h:ID code="synthetic">日本</h:ID></h:Order>',
        'XML',
        { xml: { requiredPaths: ['h:Order.h:ID'] } },
      ),
    ).resolves.toBeUndefined();
  });
});
describe('Script resource metrics without exception disclosure', () => {
  it('classifies sandbox timeouts and memory failure and releases active gauges', async () => {
    await expect(executeScript('while(true){}', { msg: {} })).rejects.toMatchObject({
      code: 'SCRIPT_TIMEOUT',
    });
    const previous = { ...config.scripts };
    try {
      config.scripts.timeout = 1000;
      config.scripts.memoryMb = 4;
      await expect(
        executeScript('return new Array(10000000).fill("synthetic")', { msg: {} }),
      ).rejects.toMatchObject({ code: 'SCRIPT_MEMORY_LIMIT' });
    } finally {
      Object.assign(config.scripts, previous);
    }
    const output = renderRuntimeMetrics();
    expect(output).toMatch(/mirth_script_timeouts_total [1-9]/);
    expect(output).toMatch(/mirth_script_memory_failures_total [1-9]/);
    expect(output).toContain('mirth_script_workers_active 0');
    expect(output).not.toContain('synthetic');
    gauge('synthetic_active', 1);
    gauge('synthetic_active', 0);
    expect(renderRuntimeMetrics()).toContain(
      '# TYPE mirth_synthetic_active gauge\nmirth_synthetic_active 0',
    );
  });
});
