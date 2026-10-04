import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { config } from './env.js';
import { logger } from '../utils/logger.js';
// IDs and counters must remain numbers in the existing API. Reject unsafe int8 values.
pg.types.setTypeParser(20, (value: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe API range');
  return number;
});
type Parameter = string | number | boolean | Date | null | undefined;
type Executor = pg.Pool | PoolClient;
export interface DatabaseResult<Row extends QueryResultRow = QueryResultRow> {
  recordset: Row[];
  recordsets: Row[][];
  rowsAffected: number[];
}
// Only parameters are compiled; all statements already use native PostgreSQL syntax.
// String/identifier/comment/dollar-quoted regions remain literal, including embedded @ or ;.
export function compileStatements(text: string, parameters: Map<string, Parameter>) {
  const tokens =
    text.match(
      /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$[\s\S]*?\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$|'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|@[A-Za-z_][A-Za-z_0-9]*|;|[^'"@$;/-]+|[\s\S]/g,
    ) ?? [];
  const statements: { text: string; values: Parameter[] }[] = [];
  let sql = '',
    values: Parameter[] = [],
    positions = new Map<string, number>();
  const flush = () => {
    if (sql.trim()) statements.push({ text: sql, values });
    sql = '';
    values = [];
    positions = new Map();
  };
  for (const token of tokens) {
    if (token === ';') {
      flush();
      continue;
    }
    if (/^@[A-Za-z_][A-Za-z_0-9]*$/.test(token)) {
      const name = token.slice(1);
      if (!parameters.has(name)) throw new Error('Missing database parameter: ' + name);
      if (!positions.has(name)) {
        values.push(parameters.get(name) ?? null);
        positions.set(name, values.length);
      }
      sql += '$' + positions.get(name);
    } else sql += token;
  }
  flush();
  return statements;
}
class DatabaseRequest {
  private readonly parameters = new Map<string, Parameter>();
  constructor(private readonly executor: Executor) {}
  input(name: string, value: Parameter) {
    this.parameters.set(name, value);
    return this;
  }
  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<DatabaseResult<Row>> {
    const results = [];
    for (const statement of compileStatements(text, this.parameters)) {
      results.push(await this.executor.query<Row>(statement.text, statement.values));
    }
    const sets = results.filter((r) => r.fields.length > 0).map((r) => r.rows);
    return {
      recordset: sets[0] ?? [],
      recordsets: sets,
      rowsAffected: results.map((r) => r.rowCount ?? 0),
    };
  }
  async batch(text: string) {
    await this.executor.query(text);
  }
}
export class DatabaseSession {
  constructor(private readonly executor: Executor) {}
  request() {
    return new DatabaseRequest(this.executor);
  }
}
export type DatabaseTransaction = DatabaseSession;
let pool: pg.Pool | undefined;
let connection: Promise<DatabaseSession> | undefined;
export function getConnection(): Promise<DatabaseSession> {
  if (!connection) {
    const candidate = new pg.Pool({
      connectionString: config.database.connectionString,
      ssl: config.database.ssl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      application_name: 'mini-mirth',
      options: '-c timezone=UTC -c search_path=' + config.database.schema,
    });
    candidate.on('error', () =>
      logger.error({ code: 'DATABASE_POOL_ERROR' }, 'Database pool error'),
    );
    pool = candidate;
    connection = candidate
      .query('SELECT 1')
      .then(() => new DatabaseSession(candidate))
      .catch(async (error) => {
        connection = undefined;
        pool = undefined;
        await candidate.end();
        throw error;
      });
  }
  return connection;
}
export async function closeConnection() {
  const current = pool;
  connection = undefined;
  pool = undefined;
  if (current) await current.end();
}
export async function withTransaction<T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  await getConnection();
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    const result = await work(new DatabaseSession(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
