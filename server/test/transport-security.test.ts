import { afterEach, describe, expect, it, vi } from 'vitest';
import type http from 'node:http';
import type net from 'node:net';
const dns = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: dns }));
vi.mock('axios', () => ({ default: { post } }));
import { config } from '../src/config/env.js';
import { sendRest, validateEndpoint } from '../src/utils/transport.js';
const allowed = config.transport.allowedHosts;
afterEach(() => {
  config.transport.allowedHosts = allowed;
});
describe('Destination SSRF policy', () => {
  it('pins the vetted DNS answer so a later private answer is never consulted', async () => {
    config.transport.allowedHosts = ['receiver.example.invalid'];
    dns
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    post.mockResolvedValue({ status: 200, data: { fixture: true } });
    await sendRest('https://receiver.example.invalid', '{}', {});
    const options = post.mock.calls[0][2];
    const agent = options.httpsAgent as http.Agent;
    const pinned = agent.options.lookup as net.LookupFunction;
    pinned('receiver.example.invalid', { all: true }, (error, addresses) => {
      expect(error).toBeNull();
      expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });
    expect(dns).toHaveBeenCalledOnce();
    expect(options).toMatchObject({ maxRedirects: 0, proxy: false });
  });
  it.each([
    '127.0.0.1',
    '[::1]',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '[::ffff:7f00:1]',
    '[fc00::1]',
  ])('rejects private/loopback %s without an explicit host allowlist', (host) => {
    config.transport.allowedHosts = [];
    expect(() => validateEndpoint('http://' + host, 'REST')).toThrow('Destination address');
  });
  it.each([
    '169.254.169.254',
    '[::ffff:a9fe:a9fe]',
    '[fe80::1]',
    '0.0.0.0',
    '224.0.0.1',
    'metadata.google.internal',
  ])('never permits prohibited destination %s, even when explicitly listed', async (host) => {
    config.transport.allowedHosts = [host.replace(/^\[|\]$/g, '')];
    await expect(sendRest('http://' + host, '{}', {})).rejects.toMatchObject({ status: 403 });
  });
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '::ffff:169.254.169.254'])(
    'rejects DNS resolving to %s before delivery',
    async (address) => {
      config.transport.allowedHosts = [];
      dns.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
      await expect(sendRest('https://receiver.example.invalid', '{}', {})).rejects.toMatchObject({
        code: 'DESTINATION_ADDRESS_DENIED',
      });
      expect(dns).toHaveBeenCalledOnce();
    },
  );
  it('rejects metadata resolved through an explicitly allowlisted hostname', async () => {
    config.transport.allowedHosts = ['receiver.example.invalid'];
    dns.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(sendRest('https://receiver.example.invalid', '{}', {})).rejects.toMatchObject({
      code: 'DESTINATION_ADDRESS_DENIED',
    });
  });
  it('keeps intentional hospital/private destinations behind explicit allowlisting', () => {
    config.transport.allowedHosts = ['10.1.2.3'];
    expect(validateEndpoint('http://10.1.2.3', 'REST').hostname).toBe('10.1.2.3');
    expect(() => validateEndpoint('http://10.1.2.4', 'REST')).toThrow();
  });
});
