import axios from 'axios';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
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
  const protocols =
    type === 'REST'
      ? ['http:', 'https:']
      : ['tcp:', 'mllp:', ...(type === 'MLLP' || type === 'HL7' ? ['mllps:'] : [])];
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
// Explicit operator probe: only DNS + TCP/TLS handshake, never HTTP/MLLP/application bytes.
// Resolve once and pin the socket to the vetted address to prevent a second DNS lookup.
export async function testConnection(endpoint: string, type: string, timeout = 5000) {
  const started = performance.now();
  const url = validateEndpoint(decrypt(endpoint), type);
  const addresses = await resolveHost(url.hostname, timeout);
  const address = addresses.find((a) => a.family === 4) || addresses[0];
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const secure = ['https:', 'mllps:'].includes(url.protocol);
  const port = Number(url.port || (secure ? 443 : 80));
  await new Promise<void>((resolve, reject) => {
    const socket = secure
      ? tls.connect({
          host: address.address,
          port,
          servername: net.isIP(hostname) ? undefined : hostname,
          rejectUnauthorized: true,
          checkServerIdentity: (_host, cert) => tls.checkServerIdentity(hostname, cert),
          ...(url.protocol === 'mllps:' && config.hl7.tls.caFile
            ? { ca: readFileSync(config.hl7.tls.caFile) }
            : {}),
          ...(url.protocol === 'mllps:' && config.hl7.tls.certFile && config.hl7.tls.keyFile
            ? {
                cert: readFileSync(config.hl7.tls.certFile),
                key: readFileSync(config.hl7.tls.keyFile),
              }
            : {}),
        })
      : net.connect({ host: address.address, port });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () =>
        finish(
          new AppError(504, 'CONNECTION_TEST_TIMEOUT', 'Destination connection test timed out'),
        ),
      Math.max(1, timeout - (performance.now() - started)),
    );
    socket.once(secure ? 'secureConnect' : 'connect', () => finish());
    socket.once('error', () =>
      finish(
        new AppError(
          502,
          secure ? 'CONNECTION_TLS_FAILED' : 'CONNECTION_TEST_FAILED',
          'Destination connection test failed',
        ),
      ),
    );
    socket.once('close', () => {
      if (!settled)
        finish(
          new AppError(502, 'CONNECTION_TEST_FAILED', 'Destination closed during connection test'),
        );
    });
  });
  return {
    reachable: true,
    secure,
    probe: secure ? 'TLS_HANDSHAKE' : 'TCP_HANDSHAKE',
    applicationDeliveryTested: false,
    elapsedMs: Math.round(performance.now() - started),
    warnings: [
      secure
        ? 'Certificate and hostname verified. Application authentication and delivery are not tested.'
        : 'Plaintext transport. Use only on a trusted isolated network. Application authentication and delivery are not tested.',
    ],
  };
}
export async function sendRest(
  endpoint: string,
  body: string,
  headers: Record<string, string>,
  timeout = config.transport.timeout,
  onResponse?: (status: number) => void,
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
    // Record transport metadata without changing the existing response-body contract.
    // Notify before rejecting non-2xx responses so failed attempts retain their actual status too.
    onResponse?.(response.status);
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
  const address = addresses.find((a) => a.family === 4)?.address || addresses[0].address;
  const controlId = mllp ? parseSegments(payload).segments[0].fields[10] : '';
  return new Promise((resolve, reject) => {
    const secure = url.protocol === 'mllps:';
    const socket = secure
        ? tls.connect({
            host: address,
            port: Number(url.port),
            servername: net.isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
            rejectUnauthorized: true,
            checkServerIdentity: (_hostname, cert) =>
              tls.checkServerIdentity(url.hostname.replace(/^\[|\]$/g, ''), cert),
            ...(config.hl7.tls.caFile ? { ca: readFileSync(config.hl7.tls.caFile) } : {}),
            ...(config.hl7.tls.certFile && config.hl7.tls.keyFile
              ? {
                  cert: readFileSync(config.hl7.tls.certFile),
                  key: readFileSync(config.hl7.tls.keyFile),
                }
              : {}),
          })
        : new net.Socket(),
      decoder = new MllpDecoder(config.server.payloadLimit);
    let settled = false,
      submitted = false;
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
      finish(
        new AppError(
          502,
          submitted ? 'DELIVERY_OUTCOME_UNKNOWN' : 'TCP_CONNECTION_ERROR',
          submitted ? 'Delivery outcome is unknown' : 'Destination connection failed',
        ),
      ),
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
    const writePayload = () => {
      submitted = true;
      socket.write(mllp ? frame(payload) : Buffer.from(payload), (error) => {
        if (error)
          finish(new AppError(502, 'DELIVERY_OUTCOME_UNKNOWN', 'Delivery outcome is unknown'));
        else if (!mllp) finish(undefined, 'TCP_WRITE_COMPLETE');
      });
    };
    if (secure) socket.once('secureConnect', writePayload);
    else socket.connect(Number(url.port), address, writePayload);
  });
}
