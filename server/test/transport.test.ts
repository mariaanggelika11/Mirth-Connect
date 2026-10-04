import { afterEach, describe, it, expect } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { sendTcp, sendRest, validateEndpoint, isUnsafeAddress } from '../src/utils/transport.js';
import { frame } from '../src/utils/mllp.js';
import { buildAck } from '../src/utils/hl7Converer.js';
import { sample } from './fixtures.js';
const servers: (net.Server | http.Server)[] = [];
const sockets = new Set<net.Socket>();
async function listen(server: net.Server | http.Server) {
  servers.push(server);
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return '127.0.0.1:' + (server.address() as net.AddressInfo).port;
}
afterEach(async () => {
  for (const s of sockets) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});
describe('Destination transports (real loopback)', () => {
  it('blocks resolved metadata/link-local addresses including IPv6 mappings', () => {
    for (const ip of [
      '169.254.169.254',
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      'fe80::1',
      '0.0.0.0',
    ])
      expect(isUnsafeAddress(ip)).toBe(true);
    expect(isUnsafeAddress('127.0.0.1')).toBe(false);
  });
  it('accepts ACK while connection stays open, including fragmented ACK', async () => {
    const endpoint = await listen(
      net.createServer((socket) =>
        socket.once('data', () => {
          const ack = frame(buildAck(sample, 'AA'));
          socket.write(ack.subarray(0, 9));
          setTimeout(() => socket.write(ack.subarray(9)), 5);
        }),
      ),
    );
    expect(await sendTcp(endpoint, sample, true, 1000)).toContain('MSA|AA|ID123');
  });
  it('rejects NACK', async () => {
    const endpoint = await listen(
      net.createServer((socket) =>
        socket.once('data', () => socket.write(frame(buildAck(sample, 'AE')))),
      ),
    );
    await expect(sendTcp(endpoint, sample, true, 1000)).rejects.toMatchObject({
      code: 'HL7_NACK_AE',
    });
  });
  it('times out without ACK', async () => {
    const endpoint = await listen(net.createServer(() => {}));
    await expect(sendTcp(endpoint, sample, true, 30)).rejects.toMatchObject({
      code: 'DESTINATION_TIMEOUT',
    });
  });
  it('closed connection without ACK is an error', async () => {
    const endpoint = await listen(
      net.createServer((socket) => socket.once('data', () => socket.end())),
    );
    await expect(sendTcp(endpoint, sample, true, 1000)).rejects.toThrow();
  });
  it('rejects mismatched ACK', async () => {
    const endpoint = await listen(
      net.createServer((socket) =>
        socket.once('data', () =>
          socket.write(frame(buildAck(sample.replace('ID123', 'wrong'), 'AA'))),
        ),
      ),
    );
    await expect(sendTcp(endpoint, sample, true, 1000)).rejects.toMatchObject({
      code: 'INVALID_ACK',
    });
  });
  it('RAW TCP uses unframed bytes', async () => {
    let received = '';
    const endpoint = await listen(
      net.createServer((socket) => socket.on('data', (d) => (received += d.toString()))),
    );
    await sendTcp(endpoint, 'raw-data', false, 1000);
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBe('raw-data');
  });
  for (const status of [200, 400, 500])
    it('REST HTTP ' + status, async () => {
      const host = await listen(
        http.createServer((_req, res) => {
          res.writeHead(status);
          res.end('{"status":"ok"}');
        }),
      );
      const result = sendRest('http://' + host, '{}', { 'Content-Type': 'application/json' }, 1000);
      if (status === 200) expect(await result).toContain('ok');
      else await expect(result).rejects.toMatchObject({ code: 'HTTP_' + status });
    });
  it('REST timeout', async () => {
    const host = await listen(http.createServer(() => {}));
    await expect(sendRest('http://' + host, '{}', {}, 30)).rejects.toThrow();
  });
  it('rejects unsupported URLs and nonallowlisted hosts', () => {
    expect(() => validateEndpoint('file:///etc/passwd', 'REST')).toThrow();
    expect(() => validateEndpoint('http://169.254.169.254', 'REST')).toThrow();
    expect(() => validateEndpoint('http://other.example', 'REST')).toThrow();
  });
});
