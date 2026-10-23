import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DestinationStageSummary,
  destinationPreviewReason,
  type DryRunResult,
} from '../src/features/channels/DryRunPreview';
import LogDetailModal from '../src/features/monitor/LogDetailModal';
import { LogLevel, type DestinationOutcome, type LogEntry } from '../src/types';

vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));

type PreviewDestination = DryRunResult['results'][number];
const preview = (changes: Partial<PreviewDestination> = {}): PreviewDestination => ({
  name: 'Synthetic receiver',
  status: 'VALID',
  enabled: true,
  routed: true,
  delivery: 'NOT_SENT',
  stages: {
    filter: 'BYPASSED',
    transformation: 'PASS_THROUGH',
    template: 'NOT_CONFIGURED',
    conversion: 'CONVERTED',
  },
  ...changes,
});
const outcome = (changes: Partial<DestinationOutcome> = {}): DestinationOutcome => ({
  destinationId: 11,
  name: 'Synthetic receiver',
  enabled: true,
  status: 'FILTERED',
  filter: 'NOT_MATCHED',
  transformation: 'NOT_RUN',
  template: 'NOT_RUN',
  conversion: 'NOT_RUN',
  delivery: 'FILTERED',
  occurredAt: '2026-10-18T10:00:00Z',
  attemptCount: 0,
  ...changes,
});
const message = (changes: Partial<LogEntry> = {}): LogEntry => ({
  id: 1,
  channelId: 1,
  channelName: 'Synthetic channel',
  timestamp: '2026-10-18T10:00:00Z',
  status: 'FILTERED',
  level: LogLevel.INFO,
  message: '',
  payloadAllowed: false,
  direction: 'IN',
  destinationOutcomes: [outcome()],
  destinationLogs: [],
  ...changes,
});
const stageHtml = (destination: PreviewDestination, detailed = false) =>
  renderToStaticMarkup(createElement(DestinationStageSummary, { destination, detailed }));
const messageHtml = (log: LogEntry) =>
  renderToStaticMarkup(createElement(LogDetailModal, { log, onClose: () => {} }));

describe('Destination dry-run presentation reflects processing without claiming delivery', () => {
  it('shows the bypassed filter and pass-through transformation with no simulated delivery success', () => {
    const html = stageHtml(preview());
    expect(html).toContain('<dt>Filter</dt><dd>Disabled</dd>');
    expect(html).toContain('<dt>Transformation</dt><dd>Pass-through</dd>');
    expect(html).toContain('Not sent (dry-run)');
    expect(html).not.toContain('Sent successfully');
    expect(html).not.toContain('HTTP 200');
    expect(html).not.toContain('<dt>Template</dt>');
  });

  it('distinguishes a filter mismatch from disabled routing and skipped source processing', () => {
    const mismatch = preview({
      routed: false,
      delivery: 'FILTERED',
      stages: { filter: 'NOT_MATCHED', transformation: 'SKIPPED' },
    });
    const disabled = preview({
      enabled: false,
      routed: false,
      delivery: 'DISABLED',
      stages: { filter: 'NOT_RUN', transformation: 'SKIPPED' },
    });
    const sourceFiltered = preview({
      routed: false,
      delivery: 'SOURCE_FILTERED',
      stages: { filter: 'NOT_RUN', transformation: 'SKIPPED' },
    });
    expect(stageHtml(mismatch)).toContain('<dt>Filter</dt><dd>Not matched</dd>');
    expect(stageHtml(mismatch)).toContain('<dt>Transformation</dt><dd>Not run</dd>');
    expect(destinationPreviewReason(mismatch)).toContain('condition did not match');
    expect(destinationPreviewReason(disabled)).toContain('destination is disabled');
    expect(stageHtml(disabled)).toContain('<dt>Filter</dt><dd>Not run</dd>');
    expect(destinationPreviewReason(sourceFiltered)).toContain('source filter stopped');
  });

  it('identifies the actual failed stage and retains an applied legacy output stage', () => {
    const failure = preview({
      status: 'ERROR',
      delivery: 'NOT_SENT_ERROR',
      stages: {
        filter: 'MATCHED',
        transformation: 'ERROR',
        template: 'SKIPPED',
        conversion: 'SKIPPED',
      },
    });
    const html = stageHtml(failure, true);
    expect(html).toContain('<dt>Filter</dt><dd>Matched</dd>');
    expect(html).toContain('<dt>Transformation</dt><dd>Failed</dd>');
    expect(html).toContain('<dt>Conversion</dt><dd>Not run</dd>');
    expect(html).toContain('Not sent · processing failed');
    expect(
      stageHtml(
        preview({
          stages: { filter: 'MATCHED', transformation: 'TRANSFORMED', template: 'APPLIED' },
        }),
      ),
    ).toContain('<dt>Template</dt><dd>Applied</dd>');
  });

  it('does not infer missing metadata from old preview responses', () => {
    const legacy = { name: 'Legacy receiver', status: 'VALID', routed: false };
    expect(stageHtml(legacy)).toBe('');
    expect(destinationPreviewReason(legacy)).toContain('Check its enabled state and filter');
  });
});

describe('Message detail separates destination processing from actual network attempts', () => {
  it('shows a zero-attempt filter outcome without creating a delivery card or exposing cached payloads', () => {
    const html = messageHtml(
      message({
        originalPayload: { patient_id: 'SYNTHETIC-PRIVATE-INPUT' },
        destinationLogs: [
          {
            destinationId: 11,
            destinationName: 'Synthetic receiver',
            status: 'FILTERED',
            responseText: '',
            networkAttempted: false,
            eventKind: 'FILTERED',
            occurredAt: '2026-10-18T10:00:00Z',
            requestData: 'SYNTHETIC-PRIVATE-REQUEST',
            outboundData: 'SYNTHETIC-PRIVATE-OUTPUT',
            attemptCount: 0,
          },
        ],
      }),
    );
    expect(html).toContain('Destination processing');
    expect(html).toContain('<dt>Filter</dt><dd>Not matched</dd>');
    expect(html).toContain('<dt>Transformation</dt><dd>Not run</dd>');
    expect(html).toContain('<dt>Network attempts</dt><dd>0</dd>');
    expect(html).toContain('No network delivery attempts recorded.');
    expect(html).not.toContain('<dt>Duration</dt>');
    expect(html).not.toContain('<dt>Attempts</dt>');
    expect(html).not.toContain('SYNTHETIC-PRIVATE');
  });

  it('does not mislabel a preparation failure as a filter mismatch or a network failure', () => {
    const html = messageHtml(
      message({
        status: 'IN-ERROR',
        destinationOutcomes: [
          outcome({
            status: 'OUT-ERROR',
            filter: 'MATCHED',
            transformation: 'ERROR',
            delivery: 'NOT_SENT',
            code: 'SCRIPT_EXECUTION_FAILED',
          }),
        ],
      }),
    );
    expect(html).toContain('<dt>Filter</dt><dd>Matched</dd>');
    expect(html).toContain('<dt>Transformation</dt><dd>Failed</dd>');
    expect(html).toContain('<dt>Delivery</dt><dd>Not sent</dd>');
    expect(html).toContain('SCRIPT_EXECUTION_FAILED');
    expect(html).toContain('No network delivery attempts recorded.');
  });

  it('keeps disabled destinations and unknown outcomes distinct without guessing a zero attempt count', () => {
    const html = messageHtml(
      message({
        destinationOutcomes: [
          outcome({ enabled: false, filter: 'NOT_RUN', delivery: 'DISABLED' }),
          outcome({
            destinationId: 12,
            name: 'Unknown legacy receiver',
            status: 'UNKNOWN',
            filter: 'UNKNOWN',
            transformation: 'UNKNOWN',
            template: 'UNKNOWN',
            conversion: 'UNKNOWN',
            delivery: 'UNKNOWN',
            attemptCount: null,
          }),
        ],
      }),
    );
    expect(html).toContain('Destination disabled');
    expect(html).toContain('<dt>Destination</dt><dd>Disabled</dd>');
    expect(html).toContain('<dt>Network attempts</dt><dd>Not recorded</dd>');
    expect(html).not.toContain('HTTP 200');
  });

  it('shows real HTTP failures with their measured duration and attempts', () => {
    const html = messageHtml(
      message({
        status: 'IN-ERROR',
        destinationOutcomes: [
          outcome({
            status: 'OUT-ERROR',
            filter: 'BYPASSED',
            transformation: 'PASS_THROUGH',
            template: 'NOT_CONFIGURED',
            conversion: 'CONVERTED',
            delivery: 'FAILED',
            attemptCount: 1,
          }),
        ],
        destinationLogs: [
          {
            destinationId: 11,
            destinationName: 'Synthetic receiver',
            status: 'OUT-ERROR',
            responseText: '',
            networkAttempted: true,
            eventKind: 'DELIVERY_ATTEMPT',
            sentAt: '2026-10-18T10:00:00Z',
            httpStatus: 503,
            durationMs: 125,
            attemptCount: 1,
          },
        ],
      }),
    );
    expect(html).toContain('HTTP 503');
    expect(html).toContain('<dt>Duration</dt><dd>125 ms</dd>');
    expect(html).toContain('<dt>Attempts</dt><dd>1</dd>');
    expect(html).not.toContain('No network delivery attempts recorded.');
    expect(html).not.toContain('HTTP 200');
  });
});
