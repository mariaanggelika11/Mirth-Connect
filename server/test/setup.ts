import { beforeEach, vi } from 'vitest';
// Tests supply an independent config. Do not load real credentials from the local dotenv file.
vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));
beforeEach(() => vi.clearAllMocks());
