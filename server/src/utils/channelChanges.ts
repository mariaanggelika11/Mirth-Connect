import { isDeepStrictEqual } from 'node:util';
import type { RevisionConfig } from '../services/revision.services.js';

export type ChannelChangeAction =
  'SOURCE_UPDATED' | 'TRANSFORMATION_UPDATED' | 'DESTINATION_UPDATED' | 'CHANNEL_UPDATED';

/** Classify changes without returning credential, payload, schema or script values. */
export function configurationChangeActions(
  previous: RevisionConfig,
  next: RevisionConfig,
): ChannelChangeAction[] {
  const actions: ChannelChangeAction[] = [];
  const source = (configuration: RevisionConfig) => ({
    type: configuration.source.type,
    inboundDataType: configuration.source.inboundDataType,
    validationProfile: configuration.validationProfile,
    filterScript: configuration.filterScript,
    responseScript: configuration.responseScript,
    idempotencyMode: configuration.idempotencyMode,
  });
  if (!isDeepStrictEqual(source(previous), source(next))) actions.push('SOURCE_UPDATED');
  if (previous.processingScript !== next.processingScript) actions.push('TRANSFORMATION_UPDATED');
  if (!isDeepStrictEqual(previous.destinations, next.destinations))
    actions.push('DESTINATION_UPDATED');
  if (previous.name !== next.name) actions.push('CHANNEL_UPDATED');
  return actions;
}

export function automaticChangeSummary(actions: ChannelChangeAction[]): string {
  const labels: Record<ChannelChangeAction, string> = {
    SOURCE_UPDATED: 'source',
    TRANSFORMATION_UPDATED: 'transformation',
    DESTINATION_UPDATED: 'destinations',
    CHANNEL_UPDATED: 'channel name',
  };
  return actions.length
    ? `Updated ${actions.map((action) => labels[action]).join(', ')}`
    : 'Configuration reviewed; no changes';
}
