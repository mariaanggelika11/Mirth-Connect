import axios from 'axios';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { config } from '../config/env.js';
import { AppError } from './errors.js';
import { decrypt } from './secrets.js';
import { frame, MllpDecoder } from './mllp.js';
import { parseSegments, readAck } from './hl7Converer.js';
export function validateEndpoint(endpoint: string, type: string) {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(endpoint) ? endpoint : 'tcp://' + endpoint);
  } catch {
    throw new AppError(400, 'INVALID_ENDPOINT', 'Invalid destination endpoint');
  }
  const protocols = type === 'REST' ? ['http:', 'https:'] : ['tcp:', 'mllp:'];
  if (
    !protocols.includes(url.protocol) ||
    !url.hostname ||
    (type !== 'REST' && (!url.port || Number(url.port) < 1 || Number(url.port) > 65535))
  )
    throw new AppError(400, 'INVALID_ENDPOINT', 'Invalid destination endpoint');
  if (
    config.transport.allowedHosts.length &&
    !config.transport.allowedHosts.includes(url.hostname.replace(/^\[|\]$/g, ''))
  )
    throw new AppError(403, 'DESTINATION_HOST_DENIED', 'Destination hostname is not allowed');
  // Cloud instance metadata must never be a connector destination.
  if (['169.254.169.254', 'metadata.google.internal'].includes(url.hostname))
    throw new AppError(403, 'DESTINATION_HOST_DENIED', 'Destination hostname is not allowed');
  return url;
}
export function isUnsafeAddress(address: string) {
  let ip = address.toLowerCase();
  const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const a = parseInt(mapped[1], 16),
      b = parseInt(mapped[2], 16);
    ip = [a >> 8, a & 255, b >> 8, b & 255].join('.');
  } else ip = ip.replace(/^::ffff:/, '');
  return (
    /^169\.254\./.test(ip) ||
    /^0\./.test(ip) ||
    /^fe[89ab][0-9a-f]:/i.test(ip) ||
    ip === '::' ||
    /^ff/i.test(ip)
  );
}
async function resolveHost(hostname: string, timeout: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const host = hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host)
      ? [{ address: host, family: net.isIP(host) }]
      : await Promise.race([
          lookup(host, { all: true }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new AppError(504, 'DNS_TIMEOUT', 'Destination lookup timed out')),
              timeout,
            );
          }),
        ]);
    if (!addresses.length || addresses.some((v) => isUnsafeAddress(v.address)))
      throw new AppError(
        403,
        'DESTINATION_ADDRESS_DENIED',
        'Destination resolved to a prohibited address',
      );
    return addresses;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export async function sendRest(
  endpoint: string,
  body: string,
  headers: Record<string, string>,
  timeout = config.transport.timeout,
): Promise<string> {
  const url = validateEndpoint(decrypt(endpoint), 'REST');
  const addresses = await resolveHost(url.hostname, timeout);
  const pinnedLookup: net.LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  };
  const httpAgent = new http.Agent({ lookup: pinnedLookup });
  const httpsAgent = new https.Agent({ lookup: pinnedLookup });
  try {
    const response = await axios.post(decrypt(endpoint), body, {
      headers,
      httpAgent,
      httpsAgent,
      timeout,
      maxRedirects: 0,
      maxBodyLength: config.server.payloadLimit,
      maxContentLength: config.server.payloadLimit,
      proxy: false,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300)
      throw new AppError(502, 'HTTP_' + response.status, 'Destination HTTP request failed');
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  } finally {
    httpAgent.destroy();
    httpsAgent.destroy();
  }
}
export async function sendTcp(
  endpoint: string,
  payload: string,
  mllp = true,
  timeout = config.transport.timeout,
): Promise<string> {
  const url = validateEndpoint(decrypt(endpoint), mllp ? 'MLLP' : 'TCP');
  const addresses = await resolveHost(url.hostname, timeout);
  const controlId = mllp ? parseSegments(payload).segments[0].fields[10] : '';
  return new Promise((resolve, reject) => {
    const socket = new net.Socket(),
      decoder = new MllpDecoder(config.server.payloadLimit);
    let settled = false;
    const finish = (error?: Error, result = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () => finish(new AppError(504, 'DESTINATION_TIMEOUT', 'Destination timed out')),
      timeout,
    );
    socket.on('error', () =>
      finish(new AppError(502, 'TCP_CONNECTION_ERROR', 'Destination connection failed')),
    );
    socket.on('close', () => {
      if (!settled) finish(new AppError(502, 'ACK_MISSING', 'Connection closed before ACK'));
    });
    socket.on('data', (chunk) => {
      try {
        const messages = decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        if (messages.length) {
          readAck(messages[0], controlId);
          finish(undefined, messages[0]);
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Invalid ACK'));
      }
    });
    socket.connect(Number(url.port), addresses[0].address, () => {
      socket.write(mllp ? frame(payload) : Buffer.from(payload), (error) => {
        if (error) finish(error);
        else if (!mllp) finish(undefined, 'TCP_WRITE_COMPLETE');
      });
    });
  });
}
