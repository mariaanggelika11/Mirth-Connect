import type { Destination } from '../../models/Destination.js';
import type { InboundStatus, OutboundStatus } from '../../models/Message.js';
export function finalStatus(statuses: string[]): InboundStatus {
  if (!statuses.length) return 'RECEIVED';
  if (statuses.every((s) => s === 'FILTERED')) return 'FILTERED';
  if (statuses.some((s) => ['PROCESSING', 'QUEUED', 'RETRYING'].includes(s))) return 'QUEUED';
  const sent = statuses.filter((s) => s === 'OUT-SENT').length;
  const failed = statuses.filter((s) => ['OUT-ERROR', 'DEAD_LETTER'].includes(s)).length;
  return failed === 0 ? 'SUCCESS' : sent > 0 ? 'PARTIAL' : 'FAILED';
}
export function retryDecision(
  dest: Pick<Destination, 'retry_enabled' | 'max_retries' | 'retry_interval_seconds'>,
  retryCount: number,
) {
  return dest.retry_enabled && retryCount < dest.max_retries
    ? {
        status: 'QUEUED' as OutboundStatus,
        delay: Math.min(86400, dest.retry_interval_seconds * 2 ** retryCount),
      }
    : {
        status: dest.retry_enabled
          ? ('DEAD_LETTER' as OutboundStatus)
          : ('OUT-ERROR' as OutboundStatus),
        delay: null,
      };
}
