import { describe, expect, it, vi, beforeEach } from 'vitest';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  send: vi.fn(),
  inputs: {} as Record<string, unknown>,
  writes: [] as { sql: string; inputs: Record<string, unknown> }[],
}));
const request = () => {
  const inputs: Record<string, unknown> = {};
  return {
    input(k: string, v: unknown) {
      inputs[k] = v;
      state.inputs[k] = v;
      return this;
    },
    query(sql: string) {
      state.writes.push({ sql, inputs: { ...inputs } });
      return state.query(sql, inputs);
    },
  };
};
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({ request }),
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ request }),
}));
vi.mock('../src/utils/transport.js', () => ({ sendRest: state.send, sendTcp: state.send }));
import { processInboundMessage } from '../src/services/messageProcessor.services.js';
import { executeScript } from '../src/services/script.services.js';
import { channelSchema } from '../src/utils/validator.js';
import { compileSimpleCondition } from '../src/utils/simpleCondition.js';
import { readSourceFilter, writeSourceFilter } from '../src/utils/sourceFilter.js';
import { encrypt } from '../src/utils/secrets.js';
const rule = compileSimpleCondition({
  version: 1,
  field: 'message_type',
  operator: 'eq',
  value: 'ADT',
});
const destination = {
  id: 2,
  channel_id: 1,
  name: 'Synthetic receiver',
  type: 'REST',
  endpoint: 'http://localhost/synthetic',
  outbound_data_type: 'JSON',
  processing_script: '',
  response_script: '',
  template_script: '',
  filter_script: '',
  retry_enabled: false,
  max_retries: 0,
  timeout_ms: 1000,
};
const configuration = {
  name: 'Synthetic filter',
  source: { type: 'HTTP', inboundDataType: 'JSON' },
  destinations: [],
  filterScript: rule,
};
function database(filter: string) {
  const channel = {
    id: 1,
    status: 'RUNNING',
    active_revision: 1,
    inbound_data_type: 'JSON',
    processing_script: 'msg.transformed = true; return msg;',
    filter_script: filter,
  };
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT * FROM "Channels"'))
      return { recordset: [channel], rowsAffected: [1] };
    if (sql.includes('SELECT * FROM "Destinations"'))
      return { recordset: [destination], rowsAffected: [1] };
    if (sql.includes('INSERT INTO "Messages"') && sql.includes("'IN'"))
      return { recordset: [{ id: 4 }], rowsAffected: [1] };
    if (sql.includes('RETURNING *'))
      return {
        recordset: [
          {
            id: 5,
            channel_id: 1,
            destination_id: 2,
            inbound_message_id: 4,
            status: 'PROCESSING',
            retry_count: 0,
            transport_config: encrypt(JSON.stringify(destination)),
          },
        ],
        rowsAffected: [1],
      };
    if (sql.includes('SELECT status FROM "Messages"'))
      return { recordset: [{ status: 'OUT-SENT' }], rowsAffected: [1] };
    return { recordset: [], rowsAffected: [1] };
  });
}
beforeEach(() => {
  state.writes = [];
  state.inputs = {};
  state.send.mockResolvedValue('ok');
});
describe('Source filters through the real sandbox and inbound processor (database/transport isolated)', () => {
  it.each([
    ['disabled', writeSourceFilter(rule, false), 'ORM'],
    ['no filter', '', 'ORM'],
    ['matching', rule, 'ADT'],
  ])(
    '%s continues transformation and delivery with identifiers intact',
    async (_label, filter, type) => {
      database(filter);
      const payload = { message_type: type, patient_id: 'SYNTHETIC-001' };
      const result = await processInboundMessage(1, payload, 'synthetic-correlation');
      expect(result).toMatchObject({ inboundStatus: 'SUCCESS', inboundMessageId: 4 });
      expect(state.send).toHaveBeenCalledOnce();
      expect(JSON.parse(state.send.mock.calls[0][1])).toEqual({ ...payload, transformed: true });
      expect(payload).toEqual({ message_type: type, patient_id: 'SYNTHETIC-001' });
      expect(
        state.writes.find((w) => w.sql.includes('INSERT INTO "Messages"'))?.inputs,
      ).toMatchObject({ correlation: 'synthetic-correlation', revision: 1 });
    },
  );
  it('evaluates each message independently; filtered messages never reserve an outbound delivery', async () => {
    database(rule);
    for (const message_type of ['ORM', 'ADT', 'ORU']) {
      const before = state.writes.length;
      const result = await processInboundMessage(1, { message_type });
      expect(result.inboundStatus).toBe(message_type === 'ADT' ? 'SUCCESS' : 'FILTERED');
      if (message_type !== 'ADT') {
        expect(state.writes.slice(before).some((w) => w.sql.includes("status='FILTERED'"))).toBe(
          true,
        );
        expect(
          state.writes
            .slice(before)
            .some((w) => w.sql.includes('INSERT INTO "Messages"') && !w.sql.includes("'IN'")),
        ).toBe(false);
      }
    }
    expect(state.send).toHaveBeenCalledOnce();
  });
  it('rejects corrupted condition metadata and records only the safe error code without delivery', async () => {
    database(rule + '\nreturn true;');
    await expect(processInboundMessage(1, { message_type: 'SYNTHETIC-PHI' })).rejects.toMatchObject(
      { code: 'FILTER_CONFIG_INVALID' },
    );
    expect(state.send).not.toHaveBeenCalled();
    expect(state.writes.find((w) => w.sql.includes("status='IN-ERROR'"))?.inputs.error).toBe(
      'FILTER_CONFIG_INVALID',
    );
  });
});
describe('Retained source filter configuration and validation', () => {
  it('round trips the exact disabled rule, survives API validation, and bypasses failing legacy code', async () => {
    for (const legacy of [
      rule,
      'return false;',
      'true',
      'false',
      'throw new Error("SYNTHETIC");',
    ]) {
      const saved = channelSchema.parse({
        ...configuration,
        filterScript: writeSourceFilter(legacy, false),
      });
      const loaded = readSourceFilter(saved.filterScript);
      expect(loaded).toEqual({ enabled: false, rule: legacy });
      expect(writeSourceFilter(loaded.rule, true)).toBe(legacy);
      await expect(executeScript(saved.filterScript, { msg: {} }, 'true')).resolves.toBe(true);
    }
    expect(readSourceFilter('')).toEqual({ enabled: false, rule: '' });
  });
  it('rejects invalid operators, paths, incomplete or corrupted reserved metadata on save', () => {
    for (const filterScript of [
      rule + '\nreturn true;',
      '/* MIRTH_SIMPLE_CONDITION_V1:%invalid */\n',
      '/* MIRTH_SOURCE_FILTER_DISABLED_V1:invalid',
    ])
      expect(channelSchema.safeParse({ ...configuration, filterScript }).success).toBe(false);
    expect(() => writeSourceFilter('x'.repeat(65536), false)).toThrow('storage limit');
    for (const legacy of ['return true;', 'return false;', 'true', 'false', 'return msg.active;'])
      expect(channelSchema.parse({ ...configuration, filterScript: legacy }).filterScript).toBe(
        legacy,
      );
  });
});
