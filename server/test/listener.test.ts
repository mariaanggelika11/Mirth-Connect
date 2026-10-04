import { describe, it, expect, vi, afterEach } from 'vitest';
import net from 'node:net';
const state = vi.hoisted(() => ({ query: vi.fn(), process: vi.fn() }));
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({ request: () => ({ query: state.query }) }),
}));
vi.mock('../src/services/messageProcessor.services.js', () => ({
  processInboundMessage: state.process,
}));
import { startHl7Listener, stopHl7Listener } from '../src/services/hl7Listener.services.js';
import { config } from '../src/config/env.js';
import { MllpDecoder, frame } from '../src/utils/mllp.js';
import { sample } from './fixtures.js';
let server: net.Server | undefined;
const clients: net.Socket[] = [];
async function exchange(chunks: Buffer[], count = 1) {
  config.hl7.port = 0;
  config.hl7.host = '127.0.0.1';
  config.hl7.allowedIps = ['127.0.0.1'];
  server = await startHl7Listener();
  return new Promise<string[]>((resolve, reject) => {
    const client = net.createConnection((server!.address() as net.AddressInfo).port, '127.0.0.1');
    clients.push(client);
    const decoder = new MllpDecoder();
    const messages: string[] = [];
    client.setTimeout(2000, () => {
      client.destroy();
      reject(new Error('test timeout'));
    });
    client.on('error', reject);
    client.on('data', (chunk) => {
      messages.push(...decoder.push(chunk));
      if (messages.length === count) {
        client.end();
        resolve(messages);
      }
    });
    client.on('connect', () => {
      chunks.forEach((chunk, i) => setTimeout(() => client.write(chunk), i * 5));
    });
  });
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  if (server) await stopHl7Listener(server);
  server = undefined;
});
describe('Inbound MLLP listener (loopback)', () => {
  it('accepts fragmented message and gives correlated AA', async () => {
    state.query.mockResolvedValue({ recordset: [{ id: 1, filter_script: '' }] });
    state.process.mockResolvedValue({ success: true });
    const bytes = frame(sample);
    const replies = await exchange([bytes.subarray(0, 20), bytes.subarray(20)]);
    expect(replies[0]).toContain('MSA|AA|ID123');
    expect(state.process).toHaveBeenCalledWith(1, sample);
  });
  it('multiple frames processed sequentially', async () => {
    state.query.mockResolvedValue({ recordset: [{ id: 1, filter_script: '' }] });
    state.process.mockResolvedValue({ success: true });
    const replies = await exchange([Buffer.concat([frame(sample), frame(sample)])], 2);
    expect(replies).toHaveLength(2);
    expect(state.process).toHaveBeenCalledTimes(2);
  });
  it('stopped/no matching channel returns AR', async () => {
    state.query.mockResolvedValue({ recordset: [] });
    const replies = await exchange([frame(sample)]);
    expect(replies[0]).toContain('MSA|AR|ID123');
    expect(state.process).not.toHaveBeenCalled();
  });
  it('destination failure returns AE', async () => {
    state.query.mockResolvedValue({ recordset: [{ id: 1, filter_script: '' }] });
    state.process.mockResolvedValue({ success: false });
    expect((await exchange([frame(sample)]))[0]).toContain('MSA|AE|ID123');
  });
  it('ambiguous routing rejects duplicate deliveries', async () => {
    state.query.mockResolvedValue({ recordset: [{ id: 1 }, { id: 2 }] });
    expect((await exchange([frame(sample)]))[0]).toContain('MSA|AR|ID123');
    expect(state.process).not.toHaveBeenCalled();
  });
  it('invalid HL7 gets AR and does not process', async () => {
    expect((await exchange([frame('PID|1')]))[0]).toContain('MSA|AR|');
    expect(state.process).not.toHaveBeenCalled();
  });
});
