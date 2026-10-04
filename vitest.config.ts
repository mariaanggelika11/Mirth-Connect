import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'client/test/**/*.test.ts'],
    setupFiles: ['./server/test/setup.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test-only-not-production@localhost:5432/MiniMirthDev_test',
      PG_SSL: 'false',
      JWT_SECRET: 'test-only-secret-that-is-more-than-32-characters',
      CONFIG_ENCRYPTION_KEY: 'a'.repeat(64),
      INBOUND_API_KEY: 'test-only-inbound-api-key-more-than-32',
      JWT_EXPIRES_IN: '3600',
      PUBLIC_REGISTRATION: 'true',
      HL7_ENABLED: 'false',
      LOG_LEVEL: 'silent',
      SCRIPT_TIMEOUT_MS: '100',
      OUTBOUND_ALLOWED_HOSTS: '127.0.0.1,localhost',
    },
    coverage: {
      provider: 'v8',
      include: ['server/src/**/*.ts', 'client/src/services/*.ts'],
      exclude: [
        'server/src/server.ts',
        'server/src/scripts/**',
        'server/src/services/scriptWorker.ts',
      ],
    },
  },
});
