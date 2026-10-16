import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  query: vi.fn(),
  closeConnection: vi.fn(),
  listen: vi.fn(),
  startHl7Listener: vi.fn(),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/app.js', () => ({ default: { listen: state.listen } }));
vi.mock('../src/config/env.js', () => ({
  config: {
    server: { shutdownTimeout: 1000 },
    hl7: { enabled: false },
  },
}));
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({ request: () => ({ query: state.query }) }),
  closeConnection: state.closeConnection,
}));
vi.mock('../src/services/hl7Listener.services.js', () => ({
  startHl7Listener: state.startHl7Listener,
  stopHl7Listener: vi.fn(),
}));
vi.mock('../src/services/worker.services.js', () => ({
  startWorkers: state.startWorkers,
  stopWorkers: state.stopWorkers,
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { error: state.error, info: vi.fn() },
}));

let previousExitCode: typeof process.exitCode;
let previousSignals: Record<'SIGTERM' | 'SIGINT', ReturnType<typeof process.listeners>>;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  previousExitCode = process.exitCode;
  previousSignals = {
    SIGTERM: process.listeners('SIGTERM'),
    SIGINT: process.listeners('SIGINT'),
  };
  state.closeConnection.mockResolvedValue(undefined);
  state.stopWorkers.mockResolvedValue(undefined);
});
afterEach(() => {
  process.exitCode = previousExitCode;
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    for (const listener of process.listeners(signal))
      if (!previousSignals[signal].includes(listener)) process.removeListener(signal, listener);
});

describe('Startup migration guard', () => {
  it.each(['missing version', 'missing migration table'])(
    '%s blocks startup with safe instructions',
    async (scenario) => {
      if (scenario === 'missing version') state.query.mockResolvedValue({ recordset: [] });
      else
        state.query.mockRejectedValue(
          Object.assign(new Error('Synthetic internal SQL and credential details'), {
            code: '42P01',
          }),
        );

      await import('../src/server.js');

      expect(state.query).toHaveBeenCalledWith(
        'SELECT version FROM "SchemaMigrations" WHERE version=6',
      );
      expect(state.error).toHaveBeenCalledWith(
        { code: 'STARTUP_FAILED', cause: 'MIGRATION_REQUIRED', stage: 'migration' },
        'Database migrations are required; run npm run db:migrate, then npm run start',
      );
      expect(JSON.stringify(state.error.mock.calls)).not.toContain('credential details');
      expect(state.listen).not.toHaveBeenCalled();
      expect(state.startHl7Listener).not.toHaveBeenCalled();
      expect(state.startWorkers).not.toHaveBeenCalled();
      expect(state.closeConnection).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(1);
    },
  );

  it('keeps database permission failures distinct and does not expose SQL', async () => {
    state.query.mockRejectedValue(
      Object.assign(new Error('Synthetic sensitive SQL detail'), { code: '42501' }),
    );

    await import('../src/server.js');

    expect(state.error).toHaveBeenCalledWith(
      { code: 'STARTUP_FAILED', cause: '42501', stage: 'migration' },
      'Startup failed; check the reported stage, configuration and database connectivity',
    );
    expect(JSON.stringify(state.error.mock.calls)).not.toContain('sensitive SQL detail');
    expect(state.listen).not.toHaveBeenCalled();
    expect(state.startWorkers).not.toHaveBeenCalled();
    expect(state.closeConnection).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
});
