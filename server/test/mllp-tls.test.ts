import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { config } from '../src/config/env.js';
import { sendTcp, testConnection } from '../src/utils/transport.js';
import { MllpDecoder, frame } from '../src/utils/mllp.js';
import { buildAck } from '../src/utils/hl7Converer.js';
import { sample } from './fixtures.js';
import { startHl7Listener, stopHl7Listener } from '../src/services/hl7Listener.services.js';
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({
    request: () => ({ query: async () => ({ recordset: [{ id: 1, filter_script: '' }] }) }),
  }),
}));
vi.mock('../src/services/messageProcessor.services.js', () => ({
  processInboundMessage: async () => ({ success: true }),
}));
let directory: string, cert: string, key: string, server: tls.Server, port: number;
const old = { ...config.hl7.tls };
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mirth-tls-test-'));
  cert = path.join(directory, 'cert.pem');
  key = path.join(directory, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  server = tls.createServer({ cert: await readFile(cert), key: await readFile(key) }, (socket) => {
    const decoder = new MllpDecoder();
    socket.on('data', (chunk) => {
      for (const raw of decoder.push(chunk)) socket.write(frame(buildAck(raw, 'AA')));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  config.hl7.tls.caFile = cert;
});
afterAll(async () => {
  Object.assign(config.hl7.tls, old);
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
describe('MLLP TLS verifies certificate and hostname', () => {
  it('probe verifies CA and hostname without sending MLLP frames', async () => {
    expect(await testConnection(`mllps://localhost:${port}`, 'MLLP', 2000)).toMatchObject({
      reachable: true,
      secure: true,
    });
    await expect(testConnection(`mllps://127.0.0.1:${port}`, 'MLLP', 2000)).rejects.toMatchObject({
      code: 'CONNECTION_TLS_FAILED',
    });
  });
  it('accepts trusted localhost certificate with framed ACK', async () => {
    expect(await sendTcp(`mllps://localhost:${port}`, sample, true, 2000)).toContain(
      'MSA|AA|ID123',
    );
  });
  it('rejects hostname mismatch before delivering patient payload', async () => {
    await expect(sendTcp(`mllps://127.0.0.1:${port}`, sample, true, 2000)).rejects.toThrow(
      'Destination connection failed',
    );
  });
  it('rejects untrusted certificate', async () => {
    config.hl7.tls.caFile = undefined;
    try {
      await expect(sendTcp(`mllps://localhost:${port}`, sample, true, 2000)).rejects.toThrow(
        'Destination connection failed',
      );
    } finally {
      config.hl7.tls.caFile = cert;
    }
  });
  it('native TLS listener can require client certificate', async () => {
    const previous = { ...config.hl7 };
    config.hl7.tls = {
      enabled: true,
      certFile: cert,
      keyFile: key,
      caFile: cert,
      requireClientCert: true,
    };
    config.hl7.port = 0;
    config.hl7.host = '127.0.0.1';
    const listener = await startHl7Listener();
    try {
      const port = (listener.address() as AddressInfo).port;
      expect(await sendTcp(`mllps://localhost:${port}`, sample, true, 2000)).toContain(
        'MSA|AA|ID123',
      );
    } finally {
      await stopHl7Listener(listener);
      Object.assign(config.hl7, previous);
    }
  });
});
