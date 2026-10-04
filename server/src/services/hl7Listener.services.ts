import net from 'node:net';
import { getConnection } from '../config/db.js';
import { config } from '../config/env.js';
import { buildAck, hl7ToJson, parseSegments } from '../utils/hl7Converer.js';
import { frame, MllpDecoder } from '../utils/mllp.js';
import { processInboundMessage } from './messageProcessor.services.js';
import { executeScript } from './script.services.js';
import { logger } from '../utils/logger.js';
import { safeError } from '../utils/errors.js';
const sockets = new Set<net.Socket>();
const active = new Set<Promise<void>>();
export async function startHl7Listener(): Promise<net.Server> {
  const server = net.createServer((socket) => {
    const ip = socket.remoteAddress?.replace(/^::ffff:/, '') || '';
    if (!config.hl7.allowedIps.includes(ip)) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.setTimeout(config.transport.timeout);
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => logger.warn({ code: 'MLLP_SOCKET_ERROR' }, 'MLLP connection failed'));
    socket.on('close', () => sockets.delete(socket));
    const decoder = new MllpDecoder(config.server.payloadLimit);
    let queue = Promise.resolve();
    let count = 0;
    socket.on('data', (chunk) => {
      try {
        const messages = decoder.push(typeof chunk==='string'?Buffer.from(chunk):chunk);
        if (count + messages.length > 100) {
          socket.destroy();
          return;
        }
        count += messages.length;
        for (const raw of messages) {
          queue = queue.then(async () => {
            socket.pause();
            socket.setTimeout(0);
            let code: 'AA' | 'AE' | 'AR' = 'AA',
              reason = '';
            try {
              parseSegments(raw);
              // Query current status on every frame, so stop takes effect without cached channel lists.
              const pool = await getConnection();
              const channels = (
                await pool
                  .request()
                  .query(
                    "SELECT id,filter_script FROM \"Channels\" WHERE status='RUNNING' AND source_type='HL7' ORDER BY id",
                  )
              ).recordset;
              const selected = [];
              for (const c of channels)
                if (
                  !c.filter_script?.trim() ||
                  (await executeScript(c.filter_script, { msg: hl7ToJson(raw) }, 'true'))
                )
                  selected.push(c);
              // Reject ambiguous routing rather than silently duplicating patient messages.
              if (selected.length !== 1) {
                code = 'AR';
                reason = selected.length
                  ? 'Ambiguous channel routing'
                  : 'No matching running channel';
              } else {
                const result = await processInboundMessage(selected[0].id, raw);
                if (!result.success) {
                  code = 'AE';
                  reason = 'Processing failed';
                }
              }
            } catch (error) {
              code = safeError(error).startsWith('INVALID_HL7') ? 'AR' : 'AE';
              reason = safeError(error);
              logger.warn({ code: reason }, 'MLLP processing failed');
            }
            if (!socket.destroyed) socket.write(frame(buildAck(raw, code, reason)));
            count--;
            socket.setTimeout(config.transport.timeout);
            socket.resume();
          });
          const work = queue;
          active.add(work);
          void work.finally(() => active.delete(work));
        }
      } catch {
        logger.warn({ code: 'INVALID_MLLP_FRAME' }, 'MLLP frame rejected');
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.hl7.port, config.hl7.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.on('error', () => logger.error({ code: 'MLLP_LISTENER_ERROR' }, 'MLLP listener failed'));
  return server;
}
export async function stopHl7Listener(server: net.Server) {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  for (const socket of sockets) socket.pause();
  await Promise.allSettled([...active]);
  for (const socket of sockets) socket.end();
  await closed;
}
