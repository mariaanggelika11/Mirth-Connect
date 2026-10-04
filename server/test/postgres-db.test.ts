import { describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('pg', () => {
  class Pool {
    on() {}
    query = state.poolQuery;
    connect = state.connect;
    end = state.end;
  }
  return { default: { Pool, types: { setTypeParser: vi.fn() } } };
});
import {
  compileStatements,
  getConnection,
  closeConnection,
  withTransaction,
} from '../src/config/db.js';
const result = (rows: Record<string, unknown>[] = [], fields = true) => ({
  rows,
  fields: fields ? [{ name: 'id' }] : [],
  rowCount: rows.length,
});
describe('PostgreSQL adapter', () => {
  it('binds values without interpolation and reuses repeated parameters', () => {
    const payload = "'; DROP TABLE Users; --";
    expect(
      compileStatements(
        'SELECT @value,@value,@empty',
        new Map([
          ['value', payload],
          ['empty', null],
        ]),
      ),
    ).toEqual([{ text: 'SELECT $1,$1,$2', values: [payload, null] }]);
  });
  it('preserves literals, identifiers, comments and dollar quotes', () => {
    const sql = `SELECT '@secret;''literal',"@column;",$$@body;$$,$tag$@tag;$tag$, @id -- @ignored;\n/* @ignored; */;SELECT @other`;
    const statements = compileStatements(
      sql,
      new Map([
        ['id', 1],
        ['other', 2],
      ]),
    );
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toContain('$$@body;$$');
    expect(statements[0].text).toContain('$tag$@tag;$tag$');
    expect(statements[0].values).toEqual([1]);
    expect(statements[1]).toEqual({ text: 'SELECT $1', values: [2] });
  });
  it('rejects unbound parameters', () =>
    expect(() => compileStatements('SELECT @missing', new Map())).toThrow(
      'Missing database parameter',
    ));
  it('executes paginated multi-statement requests separately with independent binds', async () => {
    state.poolQuery
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result([{ total: 2 }]))
      .mockResolvedValueOnce(result([{ id: 1 }]));
    const db = await getConnection();
    const rows = await db
      .request()
      .input('id', 1)
      .input('size', 10)
      .query(
        'SELECT count(*) total FROM "Messages" WHERE channel_id=@id; SELECT id FROM "Messages" WHERE channel_id=@id LIMIT @size',
      );
    expect(rows.recordsets).toEqual([[{ total: 2 }], [{ id: 1 }]]);
    expect(state.poolQuery.mock.calls[2][1]).toEqual([1, 10]);
    await closeConnection();
  });
  it('owns one client until commit and always releases it', async () => {
    state.poolQuery.mockResolvedValue(result());
    state.clientQuery.mockResolvedValue(result([{ id: 1 }]));
    state.connect.mockResolvedValue({ query: state.clientQuery, release: state.release });
    expect(
      await withTransaction(
        async (tx) => (await tx.request().input('id', 1).query('SELECT @id')).recordset[0].id,
      ),
    ).toBe(1);
    expect(state.clientQuery.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'SELECT $1', 'COMMIT']);
    expect(state.release).toHaveBeenCalledOnce();
    await closeConnection();
  });
  it('rolls back failed writes and releases the same client', async () => {
    state.poolQuery.mockResolvedValue(result());
    state.clientQuery.mockResolvedValue(result());
    state.connect.mockResolvedValue({ query: state.clientQuery, release: state.release });
    await expect(
      withTransaction(async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(state.clientQuery.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(state.release).toHaveBeenCalledOnce();
    await closeConnection();
  });
  it('retries initial connection after a failure', async () => {
    state.poolQuery
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(result());
    await expect(getConnection()).rejects.toThrow('connection refused');
    await expect(getConnection()).resolves.toBeDefined();
    await closeConnection();
  });
});
