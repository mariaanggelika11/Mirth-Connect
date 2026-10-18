import { readSourceFilter, writeSourceFilter } from '../../server/src/utils/sourceFilter';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { compileFieldMapping, readFieldMapping } from '../../server/src/utils/fieldMapping';
import {
  compileSimpleCondition,
  readSimpleCondition,
} from '../../server/src/utils/simpleCondition';

// All API and destination requests are intercepted. These fixtures contain only synthetic data.
const productionBase = 'https://connect.bulmar.tech';
const receiver = 'https://receiver.example.test/messages';
const fixtureKey = (rotation: number) => `SYNTHETIC_SOURCE_KEY_ROTATION_${rotation}`;
const inbound = { patient: '[REDACTED]' };
const rawInbound = { patient: { name: 'SYNTHETIC EXAMPLE', identifier: 'SYNTHETIC-001' } };
const xml = '[REDACTED TEXT]';
const rawXml =
  '<patient>\n  <name>SYNTHETIC EXAMPLE</name>\n  <identifier>SYNTHETIC-001</identifier>\n</patient>';
const mappedPatientXml =
  '<Patient>\n  <PatientID>SYNTHETIC-001</PatientID>\n  <PatientName>Example Patient</PatientName>\n  <Gender>U</Gender>\n  <BirthDate>2000-01-01</BirthDate>\n</Patient>';
const timestamp = '2026-10-16T02:00:00Z';
const existingChannel = {
  id: 1,
  name: 'Synthetic integration',
  status: 'STOPPED',
  activeRevision: 1,
  apiKeyConfigured: true,
  source: {
    type: 'HTTP',
    inboundDataType: 'JSON',
    endpoint: `${productionBase}/api/message/inbound/1`,
    credentialConfigured: true,
  },
  idempotencyMode: 'OPTIONAL',
  validationProfile: {},
  processingScript: '',
  filterScript: '',
  responseScript: '',
  destinations: [
    {
      id: 1,
      name: 'PATIENT_XML_RECEIVER',
      type: 'REST',
      endpoint: receiver,
      outboundDataType: 'XML',
      isEnabled: true,
      retryEnabled: false,
      timeoutMs: 10000,
    },
  ],
  received: 1,
};
type SyntheticChannel = typeof existingChannel;
interface CapturedRequest {
  path: string;
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
async function workspace(
  page: Page,
  options: { role?: string; base?: string; channels?: SyntheticChannel[] } = {},
) {
  const role = options.role || 'ADMIN';
  const base = options.base || productionBase;
  const state = {
    channels: structuredClone(options.channels || [existingChannel]),
    requests: [] as CapturedRequest[],
    details: [] as { id: number; page: number; raw: boolean }[],
    externalRequests: [] as string[],
    rotations: 0,
  };
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as Window & { __syntheticClipboard?: string }).__syntheticClipboard = value;
        },
      },
    });
  });
  await page.route('https://receiver.example.test/**', (route) => {
    state.externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/ready', (route) => route.fulfill({ json: { status: 'ready' } }));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {};
    if (method !== 'GET') state.requests.push({ path, method, body, headers: request.headers() });
    if (path === '/api/auth/browser/login') {
      const token = [
        Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
        Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
          'base64url',
        ),
        'synthetic-signature',
      ].join('.');
      return route.fulfill({ json: { token } });
    }
    if (path === '/api/auth/me')
      return route.fulfill({
        json: { success: true, data: { id: 1, name: 'Synthetic user', role } },
      });
    if (path === '/api/channel/source-configuration')
      return route.fulfill({ json: { baseUrl: base, path: '/api/message/inbound' } });
    if (path === '/api/channel' && method === 'GET') return route.fulfill({ json: state.channels });
    if (path === '/api/channel' && method === 'POST') {
      const channel = {
        ...body,
        id: 2,
        status: 'STOPPED',
        apiKeyConfigured: false,
        received: 0,
        source: {
          ...(body.source as Record<string, unknown>),
          endpoint: `${base}/api/message/inbound/2`,
          credentialConfigured: false,
        },
      } as SyntheticChannel;
      state.channels.push(channel);
      return route.fulfill({
        json: { success: true, channelId: 2, sourceEndpoint: channel.source.endpoint },
      });
    }
    if (/^\/api\/channel\/\d+\/credential$/.test(path)) {
      state.rotations++;
      return route.fulfill({
        json: { success: true, data: { apiKey: fixtureKey(state.rotations) } },
      });
    }
    if (/^\/api\/channel\/\d+\/status$/.test(path)) {
      const channel = state.channels.find((item) => item.id === Number(path.split('/')[3]));
      if (channel) channel.status = String(body.status);
      return route.fulfill({ json: { success: true } });
    }
    if (/^\/api\/channel\/\d+$/.test(path) && method === 'PUT')
      return route.fulfill({ json: { success: true, revision: 2, draft: true } });
    if (path === '/api/channel/test-connection')
      return route.fulfill({
        json: {
          success: true,
          reachable: true,
          secure: true,
          elapsedMs: 4,
          probe: 'TLS_HANDSHAKE',
          applicationDeliveryTested: false,
          warnings: [],
        },
      });
    if (path === '/api/channel/dry-run' || path === '/api/channel/preview-transformation') {
      const payload = body.raw ? body.payload : inbound;
      const configuration = body.configuration as {
        processingScript?: string;
        source?: { inboundDataType?: string };
      };
      const mapping = readFieldMapping(configuration.processingScript || '');
      // This fixed synthetic response exercises the UI contract. Runtime mapping is tested in
      // server/test/field-mapping.test.ts; this fixture does not claim to execute the engine.
      const isPatientExample =
        !!mapping &&
        mapping.rows.map((row) => row.target).join(',') ===
          'PatientID,PatientName,Gender,BirthDate';
      return route.fulfill({
        json: {
          success: true,
          accepted: true,
          elapsedMs: 5,
          networkDelivery: 'NOT_SENT',
          input: { format: configuration.source?.inboundDataType || 'JSON', payload },
          source: {
            format: 'JSON',
            payload:
              body.raw && isPatientExample
                ? {
                    ...(mapping?.rootElement
                      ? {
                          [mapping.rootElement]: {
                            PatientID: 'SYNTHETIC-001',
                            PatientName: 'Example Patient',
                            Gender: 'U',
                            BirthDate: '2000-01-01',
                          },
                        }
                      : {
                          PatientID: 'SYNTHETIC-001',
                          PatientName: 'Example Patient',
                          Gender: 'U',
                          BirthDate: '2000-01-01',
                        }),
                  }
                : payload,
            validation: 'PASSED',
            filter: 'ACCEPTED',
            transformation: configuration.processingScript?.trim() ? 'TRANSFORMED' : 'PASS_THROUGH',
          },
          results: [
            {
              name: 'PATIENT_XML_RECEIVER',
              outputFormat: 'XML',
              connectorType: 'REST',
              status: 'VALID',
              routed: true,
              finalPayload: body.raw
                ? isPatientExample
                  ? mapping?.rootElement === 'Patient'
                    ? mappedPatientXml
                    : mappedPatientXml
                        .replace('<Patient>', '<root>')
                        .replace('</Patient>', '</root>')
                  : rawXml
                : xml,
              stages: {
                filter: 'ACCEPTED',
                transformation: 'PASS_THROUGH',
                conversion: 'CONVERTED',
              },
            },
          ],
          warnings: [],
        },
      });
    }
    if (path.startsWith('/api/message/inbound/'))
      return route.fulfill({
        json: {
          success: true,
          result: {
            success: true,
            inboundMessageId: 1,
            inboundStatus: 'SUCCESS',
            outboundResults: [],
          },
        },
      });
    if (path === '/api/message/stats')
      return route.fulfill({
        json: {
          totalReceived: 1,
          totalSent: 1,
          totalErrors: 0,
          channelsRunning: 0,
          channelsStopped: state.channels.length,
          channelsError: 0,
          messagesToday: 1,
          queuedMessages: 0,
          deadLetterMessages: 0,
        },
      });
    if (path === '/api/message') {
      const direction = url.searchParams.get('direction') || 'IN';
      const rows = [
        { id: 1, direction: 'IN', status: 'SUCCESS' },
        { id: 2, direction: 'OUT', status: 'OUT-SENT' },
      ];
      const data = url.searchParams.get('statusGroup')
        ? []
        : rows
            .filter((item) => direction === 'ALL' || item.direction === direction)
            .map((item) => ({
              ...item,
              channelId: 1,
              channelName: existingChannel.name,
              timestamp,
              level: 'INFO',
              retryCount: 0,
              destinationLogs: [],
            }));
      return route.fulfill({
        json: { success: true, data, pagination: { page: 1, pageSize: 50, total: data.length } },
      });
    }
    if (/^\/api\/message\/\d+$/.test(path)) {
      const id = Number(path.split('/')[3]);
      const raw = url.searchParams.get('raw') === 'true';
      const logPage = Number(url.searchParams.get('logPage') || 1);
      state.details.push({ id, page: logPage, raw });
      return route.fulfill({
        json: {
          success: true,
          data: {
            id,
            direction: id === 2 ? 'OUT' : 'IN',
            status: id === 2 ? 'OUT-SENT' : 'SUCCESS',
            channelId: 1,
            channelName: existingChannel.name,
            timestamp,
            channelRevision: 1,
            inboundFormat: 'JSON',
            sourceTransformed: false,
            payloadAllowed: role !== 'VIEWER',
            rawPayload: raw,
            originalPayload: id === 2 ? inbound : raw ? rawInbound : inbound,
            transformedPayload: id === 2 ? xml : raw ? rawInbound : inbound,
            destinationPagination: { page: logPage, pageSize: 1, hasNext: logPage === 1 },
            destinationLogs: [
              {
                messageId: 2,
                destinationId: 1,
                destinationName: 'PATIENT_XML_RECEIVER',
                outboundFormat: 'XML',
                connectorType: 'REST',
                snapshotCaptured: true,
                httpStatus: logPage === 1 ? 201 : 503,
                status: logPage === 1 ? 'OUT-SENT' : 'OUT-ERROR',
                sentAt: logPage === 1 ? timestamp : '2026-10-16T01:59:00Z',
                requestData: raw ? rawInbound : inbound,
                outboundData: raw ? rawXml : xml,
                responseText:
                  logPage === 1 ? 'Synthetic destination accepted' : 'REMOTE_HTTP_ERROR',
              },
            ],
          },
        },
      });
    }
    // A rejected unexpected mutation prevents a missing fixture from making an action look successful.
    return route.fulfill({
      status: method === 'GET' ? 200 : 500,
      json: { success: false, code: 'UNEXPECTED_SYNTHETIC_REQUEST', data: [] },
    });
  });
  await page.goto('/');
  await page.locator('input[type="text"]').fill('synthetic-user');
  await page.locator('input[type="password"]').fill('synthetic-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Channels', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible();
  return state;
}
const captured = (state: Awaited<ReturnType<typeof workspace>>, path: string) =>
  state.requests.filter((request) => request.path === path);
async function clipboard(page: Page) {
  return page.evaluate(
    () => (window as Window & { __syntheticClipboard?: string }).__syntheticClipboard || '',
  );
}
async function step(page: Page, index: number) {
  await page.getByLabel('Channel setup steps').getByRole('button').nth(index).click();
}
async function openExisting(page: Page, name = existingChannel.name) {
  await page.getByLabel(`More actions for ${name}`).click();
  await page.getByRole('button', { name: 'Edit channel', exact: true }).click();
}
async function openSourceAdvanced(page: Page) {
  await page.getByText('Advanced source settings', { exact: true }).click();
  await page.locator('details[aria-label="Source filter settings"] > summary').click();
}
async function newJsonXmlChannel(page: Page) {
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_JSON_TO_XML');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Destination name').fill('PATIENT_XML_RECEIVER');
  await page.getByLabel('Outbound format', { exact: false }).selectOption('XML');
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
}
async function preview(page: Page, raw = false, payload: unknown = rawInbound) {
  await step(page, 3);
  await page.getByRole('textbox', { name: /^Test input · JSON/ }).fill(JSON.stringify(payload));
  if (raw) {
    const rawOption = page.getByRole('checkbox', {
      name: 'Show unmasked preview (access is audited)',
    });
    if (!(await rawOption.isVisible()))
      await page.getByText('Advanced test options', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Show unmasked preview (access is audited)' }).check();
  }
  await page.getByRole('button', { name: 'Test Transformation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    'Test completed',
  );
}
async function addPatientMappings(page: Page) {
  const fields = [
    ['patient_id', 'PatientID'],
    ['name', 'PatientName'],
    ['gender', 'Gender'],
    ['date_of_birth', 'BirthDate'],
  ];
  for (const [index, [source, target]] of fields.entries()) {
    await page.getByRole('button', { name: 'Add Mapping', exact: true }).click();
    await page.getByLabel(`Source Field ${index + 1}`, { exact: true }).fill(source);
    await page.getByLabel(`Target Field ${index + 1}`, { exact: true }).fill(target);
    if (index < 2) {
      await page.locator(`details[aria-label="Mapping options ${index + 1}"] > summary`).click();
      await page
        .getByRole('checkbox', { name: `Required field ${index + 1}`, exact: true })
        .check();
      await page.locator(`details[aria-label="Mapping options ${index + 1}"] > summary`).click();
    }
  }
}

test('four-step setup keeps core choices visible and technical options optional', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  const steps = page.getByLabel('Channel setup steps').getByRole('button');
  await expect(steps).toHaveCount(4);
  for (const [index, label] of [
    'Source',
    'Transformation',
    'Destinations',
    'Review & Test',
  ].entries())
    await expect(steps.nth(index)).toContainText(label);
  await expect(page.getByRole('region', { name: 'Source authentication' })).toBeVisible();
  await expect(
    page.getByText(`${productionBase}/api/message/inbound/{channelId}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Enable source filter' })).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Configure transformation', exact: true }).first(),
  ).not.toBeVisible();
  await expect(page.getByLabel('Duplicate message protection', { exact: false })).toHaveCount(0);
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_COMPACT_SETUP');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transformation', exact: true })).toBeVisible();
  await expect(
    page.getByText('Map incoming fields to the fields required by the destination.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Input format', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /^Output format/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use patient example', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Test Transformation', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Test input', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'Show unmasked preview (access is audited)' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Mapping', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Script', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Destination name')).toHaveCount(1);
  await page.getByLabel('Destination name').fill('SYNTHETIC_RECEIVER');
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
  await expect(page.getByLabel('Destination filter', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Automatic retry' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Destination', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Integration flow')).toContainText('HTTP / JSON');
  await expect(
    page.getByRole('button', { name: 'Test Transformation', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Change summary', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const onboarding = page.getByRole('dialog', { name: 'Channel saved', exact: true });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Create API key' })).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Start channel' })).toBeVisible();
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  expect(captured(state, '/api/channel/test-connection')).toEqual([]);
  expect(captured(state, '/api/message/inbound/2')).toEqual([]);
  expect(state.rotations).toBe(0);
  expect(state.externalRequests).toEqual([]);
});

test('jumping to review directs incomplete destinations back to their fields', async ({ page }) => {
  const state = await workspace(page, { channels: [] });
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_INCOMPLETE_SETUP');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Each destination needs a name and endpoint.',
  );
  await expect(page.getByLabel('Destination name')).toBeVisible();
  await expect(page.getByLabel('Endpoint', { exact: false })).toBeVisible();
  expect(captured(state, '/api/channel').filter((request) => request.method === 'POST')).toEqual(
    [],
  );
});

test('visible source authentication rotates explicitly and navigating clears the one-time key', async ({
  page,
}) => {
  if (process.env.UI_REVIEW_SCREENSHOT) await page.setViewportSize({ width: 1440, height: 1600 });
  const state = await workspace(page);
  let releaseRotation = () => {};
  const rotationPending = new Promise<void>((resolve) => {
    releaseRotation = resolve;
  });
  await page.route('**/api/channel/1/credential', async (route) => {
    await rotationPending;
    await route.fallback();
  });
  await openExisting(page);
  const rotate = page.getByRole('button', { name: 'Create / rotate source API key' });
  await expect(page.getByLabel('Channel name', { exact: false })).toHaveValue(existingChannel.name);
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
  await expect(rotate).toBeVisible();
  if (process.env.UI_REVIEW_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_REVIEW_SCREENSHOT });
  await rotate.click();
  expect(state.rotations).toBe(0);
  await page.getByRole('button', { name: 'Confirm key rotation', exact: true }).click();
  try {
    await expect(page.getByRole('button', { name: 'Working…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Create or rotate source key?' })).toBeVisible();
    expect(state.rotations).toBe(0);
  } finally {
    releaseRotation();
  }
  await expect(page.getByText(fixtureKey(1), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText(fixtureKey(1), { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText(fixtureKey(1), { exact: true })).toHaveCount(0);
  expect(state.rotations).toBe(1);
  await page.getByRole('combobox', { name: 'Source connector', exact: true }).selectOption('HL7');
  await expect(rotate).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Current source endpoint' })).toHaveCount(0);
});

test('JSON to XML preview, connection test and confirmed onboarding delivery keep separate effects', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toHaveCount(0);
  await step(page, 3);
  await page.getByText('Advanced test options', { exact: true }).click();
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText('Endpoint reachable', { exact: true })).toBeVisible();
  expect(captured(state, '/api/channel/test-connection')[0].body).toEqual({
    endpoint: receiver,
    type: 'REST',
    timeoutMs: 10000,
  });
  await preview(page);
  const output = page.getByRole('region', { name: 'Generated output', exact: true });
  await expect(output).toContainText(xml);
  const stages = output.getByLabel('Transformation test stages', { exact: true });
  await expect(stages).toBeVisible();
  await expect(stages).toContainText('Passed');
  await expect(stages).toContainText('Accepted');
  await expect(stages).toContainText('Pass-through');
  await expect(stages).toContainText('NOT SENT');
  expect(captured(state, '/api/channel/preview-transformation')[0].body).toMatchObject({
    raw: false,
    payload: rawInbound,
    configuration: {
      validationProfile: {},
      idempotencyMode: 'OPTIONAL',
      processingScript: '',
      filterScript: '',
      destinations: [{ outboundDataType: 'XML', retryEnabled: false }],
    },
  });
  expect(state.externalRequests).toEqual([]);
  expect(captured(state, '/api/message/inbound/2')).toEqual([]);
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const onboarding = page.getByRole('dialog', { name: 'Channel saved', exact: true });
  await expect(onboarding).toBeVisible();
  expect(
    captured(state, '/api/channel').find((request) => request.method === 'POST')?.body,
  ).toMatchObject({ changeSummary: 'Initial channel configuration' });
  await expect(
    onboarding.getByRole('button', { name: 'Send synthetic message' }),
  ).not.toBeVisible();
  await onboarding.getByText('Test this channel', { exact: true }).click();
  const endpoint = onboarding.getByRole('region', { name: 'Current source endpoint' });
  await expect(endpoint).toContainText(`${productionBase}/api/message/inbound/2`);
  await expect(endpoint.getByRole('button')).toHaveCount(0);
  await expect(endpoint.locator('summary')).toHaveCount(0);
  await expect(
    endpoint.getByText(
      'Replace the API key and request ID placeholders before sending synthetic data.',
      { exact: true },
    ),
  ).toHaveCount(0);
  await onboarding.getByRole('button', { name: 'Create API key', exact: true }).click();
  expect(state.rotations).toBe(0);
  await page.getByRole('button', { name: 'Create key', exact: true }).click();
  await expect(onboarding.locator('code').filter({ hasText: fixtureKey(1) })).toBeVisible();
  await onboarding.getByRole('button', { name: 'Rotate API key', exact: true }).click();
  expect(state.rotations).toBe(1);
  await page.getByRole('button', { name: 'Create key', exact: true }).click();
  await expect(onboarding.locator('code').filter({ hasText: fixtureKey(1) })).toHaveCount(0);
  await expect(onboarding.locator('code').filter({ hasText: fixtureKey(2) })).toBeVisible();
  await onboarding.getByRole('button', { name: 'Start channel', exact: true }).click();
  await expect(
    onboarding.getByRole('button', { name: 'Channel running', exact: true }),
  ).toBeDisabled();
  expect(captured(state, '/api/channel/2/status')[0].body).toEqual({ status: 'RUNNING' });
  await onboarding.getByRole('button', { name: 'Send synthetic message', exact: true }).click();
  expect(captured(state, '/api/message/inbound/2')).toHaveLength(0);
  await page.getByRole('button', { name: 'Send test request', exact: true }).click();
  await expect(onboarding.getByText('Test message received · #1.', { exact: false })).toBeVisible();
  const delivery = captured(state, '/api/message/inbound/2')[0];
  expect(delivery.body).toEqual({ message: 'Synthetic connection test' });
  expect(delivery.headers['x-api-key']).toBe(fixtureKey(2));
  expect(delivery.headers['idempotency-key']).toMatch(/^[\da-f-]{36}$/i);
  await onboarding.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText(fixtureKey(2), { exact: true })).toHaveCount(0);
  await openExisting(page, 'SYNTHETIC_JSON_TO_XML');
  await expect(page.getByText(fixtureKey(2), { exact: true })).toHaveCount(0);
  expect(await clipboard(page)).not.toContain(fixtureKey(2));
});

test('advanced filtering validation retry and timeout remain optional and preserve edits', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('Synthetic advanced choices');
  await openSourceAdvanced(page);
  await page
    .locator('summary')
    .filter({ hasText: /^Validation/ })
    .click();
  await page.getByRole('radio', { name: 'Basic validation' }).check();
  await expect(page.getByLabel('Custom validation schema editor', { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('Duplicate message protection', { exact: false })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Enable source filter' }).check();
  const condition = page.getByRole('group', {
    name: 'Source filter simple condition',
    exact: true,
  });
  await condition.getByLabel('Field', { exact: true }).fill('patient.id');
  await condition.getByLabel('Operator', { exact: true }).selectOption('isNotEmpty');
  await page.getByRole('checkbox', { name: 'Enable source filter' }).uncheck();
  await expect(condition).not.toBeVisible();
  await page.getByRole('checkbox', { name: 'Enable source filter' }).check();
  await expect(condition.getByLabel('Field', { exact: true })).toHaveValue('patient.id');
  await page.getByRole('checkbox', { name: 'Enable source filter' }).uncheck();
  await step(page, 2);
  await page.getByLabel('Destination name').fill('PATIENT_XML_RECEIVER');
  await page.getByLabel('Outbound format', { exact: false }).selectOption('XML');
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
  await expect(page.getByRole('checkbox', { name: 'Automatic retry' })).not.toBeVisible();
  await page.getByText('Advanced destination settings', { exact: true }).click();
  await page
    .locator('summary')
    .filter({ hasText: /^Delivery settings/ })
    .click();
  await expect(page.getByRole('checkbox', { name: 'Automatic retry' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Automatic retry' }).check();
  await page.getByLabel('Retry attempts', { exact: true }).fill('4');
  await page.getByLabel('Retry interval (seconds)', { exact: true }).fill('15');
  await page.getByLabel('Request timeout (seconds)', { exact: true }).fill('2.5');
  await page.getByRole('checkbox', { name: 'Automatic retry' }).uncheck();
  await expect(page.getByLabel('Retry attempts', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Automatic retry' }).check();
  await expect(page.getByLabel('Retry attempts', { exact: true })).toHaveValue('4');
  await preview(page);
  expect(captured(state, '/api/channel/preview-transformation')[0].body).toMatchObject({
    configuration: {
      validationProfile: { basicSyntax: true },
      filterScript: writeSourceFilter(
        compileSimpleCondition({ version: 1, field: 'patient.id', operator: 'isNotEmpty' }),
        false,
      ),
      processingScript: '',
      destinations: [
        { retryEnabled: true, maxRetries: 4, retryIntervalSeconds: 15, timeoutMs: 2500 },
      ],
    },
  });
  expect(state.externalRequests).toEqual([]);
});

function legacyChannel() {
  return {
    ...existingChannel,
    idempotencyMode: 'REQUIRED',
    validationProfile: { jsonSchema: { type: 'object', required: ['patient'] } },
    processingScript: 'return msg;',
    filterScript: 'return Boolean(msg);',
    responseScript: 'return response;',
    destinations: [
      {
        ...existingChannel.destinations[0],
        retryEnabled: true,
        maxRetries: 4,
        retryIntervalSeconds: 20,
        timeoutMs: 2500,
        processingScript: 'return msg;',
        filterScript: 'return true;',
        templateScript: 'return msg;',
        responseScript: 'return response;',
        deliveryPolicy: { failureThreshold: 3, openSeconds: 30, maxConcurrency: 2 },
      },
    ],
  };
}

for (const legacy of [
  'return true;',
  'return false;',
  'true',
  'false',
  'return Boolean(msg.patient);',
]) {
  test(`legacy source filter stays intact without an editor: ${legacy}`, async ({ page }) => {
    const state = await workspace(page, {
      channels: [{ ...existingChannel, filterScript: legacy }],
    });
    await openExisting(page);
    await openSourceAdvanced(page);
    await expect(page.getByText('Legacy source filter retained.', { exact: false })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Source filter', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Source filter script', { exact: false })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Enable source filter' }).uncheck();
    await step(page, 3);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    const saved = captured(state, '/api/channel/1')[0].body;
    expect(readSourceFilter(String(saved.filterScript))).toEqual({ enabled: false, rule: legacy });
    expect(state.externalRequests).toEqual([]);
  });
}

test('disabled source condition survives create save reopen and re-enable', async ({ page }) => {
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  await step(page, 0);
  await openSourceAdvanced(page);
  const enabled = page.getByRole('checkbox', { name: 'Enable source filter' });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  const condition = page.getByRole('group', {
    name: 'Source filter simple condition',
    exact: true,
  });
  await condition.getByLabel('Field', { exact: true }).fill('patient.id');
  await condition.getByLabel('Operator', { exact: true }).selectOption('isNotEmpty');
  await enabled.uncheck();
  await expect(condition).not.toBeVisible();
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = String(captured(state, '/api/channel')[0].body.filterScript);
  const rule = compileSimpleCondition({ version: 1, field: 'patient.id', operator: 'isNotEmpty' });
  expect(readSourceFilter(saved)).toEqual({ enabled: false, rule });
  await page
    .getByRole('dialog', { name: 'Channel saved', exact: true })
    .getByLabel('Close dialog')
    .click();
  await openExisting(page, 'SYNTHETIC_JSON_TO_XML');
  await openSourceAdvanced(page);
  await expect(enabled).not.toBeChecked();
  await expect(condition).not.toBeVisible();
  await enabled.check();
  await expect(condition.getByLabel('Field', { exact: true })).toHaveValue('patient.id');
  await expect(condition.getByLabel('Operator', { exact: true })).toHaveValue('isNotEmpty');
  await expect(condition.getByLabel('Value', { exact: true })).toHaveCount(0);
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel/2')[0].body.filterScript).toBe(rule);
});

test('legacy source filter replacement is explicit and requires a valid condition', async ({
  page,
}) => {
  const state = await workspace(page, {
    channels: [{ ...existingChannel, filterScript: 'return false;' }],
  });
  await openExisting(page);
  await openSourceAdvanced(page);
  await page.getByRole('button', { name: 'Replace with simple condition', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Complete the source filter condition' }),
  ).toBeVisible();
  const condition = page.getByRole('group', {
    name: 'Source filter simple condition',
    exact: true,
  });
  await condition.getByLabel('Field', { exact: true }).fill('patient.department');
  await condition.getByLabel('Value', { exact: true }).fill('LAB');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(
    readSimpleCondition(String(captured(state, '/api/channel/1')[0].body.filterScript)),
  ).toMatchObject({ field: 'patient.department', operator: 'eq', value: 'LAB' });
});

test('editing preserves advanced legacy settings while removing the mandatory change summary', async ({
  page,
}) => {
  const legacy = legacyChannel();
  const state = await workspace(page, { channels: [legacy] });
  await openExisting(page);
  await openSourceAdvanced(page);
  await page
    .locator('summary')
    .filter({ hasText: /^Validation/ })
    .click();
  await expect(page.getByRole('radio', { name: 'Custom validation schema' })).toBeChecked();
  await expect(page.getByLabel('Custom validation schema editor', { exact: false })).toContainText(
    'patient',
  );
  await expect(
    page.getByText('Legacy custom source response is active.', { exact: true }),
  ).toBeVisible();
  await step(page, 1);
  await expect(
    page.getByText('A custom transformation is configured.', { exact: false }),
  ).toBeVisible();
  await step(page, 3);
  await expect(page.getByLabel('Change summary', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(captured(state, '/api/channel/1')[0].body).toMatchObject({
    validationProfile: legacy.validationProfile,
    processingScript: legacy.processingScript,
    filterScript: legacy.filterScript,
    responseScript: legacy.responseScript,
    destinations: legacy.destinations,
    changeSummary: 'Channel configuration updated',
    idempotencyMode: 'REQUIRED',
  });
});

test('name-only editing keeps every hidden advanced setting unchanged', async ({ page }) => {
  const legacy = legacyChannel();
  const state = await workspace(page, { channels: [legacy] });
  await openExisting(page);
  await expect(
    page.getByRole('button', { name: 'Configure transformation', exact: true }).first(),
  ).not.toBeVisible();
  await expect(
    page.getByLabel('Custom validation schema editor', { exact: false }),
  ).not.toBeVisible();
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_RENAMED_CHANNEL');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(captured(state, '/api/channel/1')[0].body).toMatchObject({
    name: 'SYNTHETIC_RENAMED_CHANNEL',
    idempotencyMode: legacy.idempotencyMode,
    validationProfile: legacy.validationProfile,
    processingScript: legacy.processingScript,
    filterScript: legacy.filterScript,
    responseScript: legacy.responseScript,
    destinations: legacy.destinations,
  });
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  expect(state.rotations).toBe(0);
});

for (const [label, base] of [
  ['local', 'http://localhost:9000'],
  ['production', productionBase],
] as const)
  test(`${label} source endpoint stays visible without copy controls or request examples`, async ({
    page,
  }) => {
    await workspace(page, {
      base,
      channels: [
        {
          ...existingChannel,
          source: { ...existingChannel.source, endpoint: `${base}/api/message/inbound/1` },
        },
      ],
    });
    await openExisting(page);
    const endpoint = page.getByRole('region', { name: 'Current source endpoint' });
    await expect(endpoint).toBeVisible();
    await expect(endpoint).toContainText(`${base}/api/message/inbound/1`);
    await expect(endpoint.getByRole('button')).toHaveCount(0);
    await expect(endpoint.locator('summary')).toHaveCount(0);
    await expect(
      endpoint.getByText(
        'Replace the API key and request ID placeholders before sending synthetic data.',
        { exact: true },
      ),
    ).toHaveCount(0);
  });

test('simple source and destination conditions save safely without opening a script editor', async ({
  page,
}) => {
  if (process.env.UI_FINAL_SOURCE_SCREENSHOT || process.env.UI_FINAL_DESTINATIONS_SCREENSHOT)
    await page.setViewportSize({ width: 1440, height: 1600 });
  const state = await workspace(page);
  await openExisting(page);
  await openSourceAdvanced(page);
  await page.locator('details[aria-label="Source validation settings"] > summary').click();
  await page.getByRole('radio', { name: 'Basic validation', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Enable source filter' }).check();
  const sourceCondition = page.getByRole('group', {
    name: 'Source filter simple condition',
    exact: true,
  });
  await sourceCondition.getByLabel('Field', { exact: true }).fill('message_type');
  await sourceCondition.getByLabel('Value', { exact: true }).fill('ADT');
  await expect(page.getByLabel('Source filter script', { exact: true })).toHaveCount(0);
  await page.locator('details[aria-label="Source transformer settings"] > summary').click();
  await expect(
    page.getByRole('group', { name: 'Source transformer settings', exact: true }),
  ).toContainText('No transformation');
  if (process.env.UI_FINAL_SOURCE_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_FINAL_SOURCE_SCREENSHOT });
  await step(page, 2);
  await page.getByText('Advanced destination settings', { exact: true }).click();
  const destinationAdvanced = page.locator('.destination-editor > details');
  await expect(destinationAdvanced.locator(':scope > details > summary')).toHaveText([
    'Destination filter',
    'Destination transformer',
    'Delivery settings',
  ]);
  await page.locator('details[aria-label="Destination filter settings"] > summary').click();
  await page
    .getByRole('combobox', { name: 'Destination filter', exact: true })
    .selectOption('simple');
  const destinationCondition = page.getByRole('group', {
    name: 'Destination filter simple condition',
    exact: true,
  });
  await destinationCondition.getByLabel('Field', { exact: true }).fill('department');
  await destinationCondition.getByLabel('Value', { exact: true }).fill('LAB');
  await page.locator('details[aria-label="Destination transformer settings"] > summary').click();
  await page.locator('details[aria-label="Delivery settings"] > summary').click();
  await expect(page.getByLabel('Destination filter script', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Configure custom response', exact: true }),
  ).toHaveCount(0);
  if (process.env.UI_FINAL_DESTINATIONS_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_FINAL_DESTINATIONS_SCREENSHOT });
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await step(page, 3);
  const processing = page.getByRole('region', { name: 'Source processing summary', exact: true });
  await expect(processing).toContainText('Basic');
  await expect(processing).toContainText('Simple condition');
  await expect(processing).toContainText('None (pass-through)');
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = captured(state, '/api/channel/1')[0].body;
  expect(readSimpleCondition(String(saved.filterScript))).toEqual({
    version: 1,
    field: 'message_type',
    operator: 'eq',
    value: 'ADT',
  });
  expect(
    readSimpleCondition((saved.destinations as { filterScript: string }[])[0].filterScript),
  ).toEqual({ version: 1, field: 'department', operator: 'eq', value: 'LAB' });
  expect(saved.validationProfile).toEqual({ basicSyntax: true });
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  expect(state.externalRequests).toEqual([]);
});

test('unfinished source conditions block navigation and survive disabling without saving an older condition', async ({
  page,
}) => {
  const original = compileSimpleCondition({
    version: 1,
    field: 'message_type',
    operator: 'eq',
    value: 'ADT',
  });
  const state = await workspace(page, {
    channels: [{ ...existingChannel, filterScript: original }],
  });
  await openExisting(page);
  await openSourceAdvanced(page);
  const condition = page.getByRole('group', {
    name: 'Source filter simple condition',
    exact: true,
  });
  await condition.getByLabel('Field', { exact: true }).fill('patient.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Complete the source filter condition' }),
  ).toBeVisible();
  await step(page, 3);
  await expect(page.getByLabel('Channel name', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Enable source filter' }).uncheck();
  await expect(condition).not.toBeVisible();
  await step(page, 1);
  await step(page, 0);
  await page.getByRole('checkbox', { name: 'Enable source filter' }).check();
  await expect(condition.getByLabel('Field', { exact: true })).toHaveValue('patient.');
  await step(page, 2);
  await expect(page.getByLabel('Channel name', { exact: false })).toBeVisible();
  await condition.getByLabel('Field', { exact: true }).fill('patient.age');
  await condition.getByLabel('Operator', { exact: true }).selectOption('gte');
  await expect(condition.getByLabel('Value', { exact: true })).toHaveAttribute('type', 'number');
  await condition.getByLabel('Value', { exact: true }).fill('18');
  await condition.getByLabel('Operator', { exact: true }).selectOption('exists');
  await expect(condition.getByLabel('Value', { exact: true })).toHaveCount(0);
  await condition.getByLabel('Operator', { exact: true }).selectOption('gte');
  await expect(condition.getByLabel('Value', { exact: true })).toHaveValue('18');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = captured(state, '/api/channel/1')[0].body;
  expect(readSimpleCondition(String(saved.filterScript))).toEqual({
    version: 1,
    field: 'patient.age',
    operator: 'gte',
    value: '18',
  });
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  expect(state.externalRequests).toEqual([]);
});

test('invalid destination conditions cannot leave the step or affect the next destination after removal', async ({
  page,
}) => {
  const remainingScript = compileSimpleCondition({
    version: 1,
    field: 'department',
    operator: 'eq',
    value: 'LAB',
  });
  const channel = {
    ...existingChannel,
    destinations: [
      { ...existingChannel.destinations[0], id: 1, name: 'First destination' },
      {
        ...existingChannel.destinations[0],
        id: 2,
        name: 'Remaining destination',
        filterScript: remainingScript,
      },
    ],
  };
  const state = await workspace(page, { channels: [channel] });
  await openExisting(page);
  await step(page, 2);
  const first = page.locator('.destination-editor').nth(0);
  await first.getByText('Advanced destination settings', { exact: true }).click();
  await first.locator('details[aria-label="Destination filter settings"] > summary').click();
  await first
    .getByRole('combobox', { name: 'Destination filter', exact: true })
    .selectOption('simple');
  await first.getByLabel('Field', { exact: true }).fill('patient.');
  await step(page, 3);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Complete the filter condition for destination 1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(first.getByLabel('Field', { exact: true })).toHaveValue('patient.');
  await first.getByRole('button', { name: 'Remove destination 1', exact: true }).click();
  await expect(page.locator('.destination-editor')).toHaveCount(1);
  const remaining = page.locator('.destination-editor');
  await remaining.getByText('Advanced destination settings', { exact: true }).click();
  await remaining.locator('details[aria-label="Destination filter settings"] > summary').click();
  await expect(remaining.getByLabel('Field', { exact: true })).toHaveValue('department');
  await expect(remaining.getByLabel('Value', { exact: true })).toHaveValue('LAB');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(
    captured(state, '/api/channel/1')[0].body.destinations as {
      name: string;
      filterScript: string;
    }[],
  ).toMatchObject([{ name: 'Remaining destination', filterScript: remainingScript }]);
});

for (const format of ['XML', 'HL7V2'] as const)
  test(`Basic validation can be selected for ${format} without exposing a raw profile`, async ({
    page,
  }) => {
    const state = await workspace(page);
    await openExisting(page);
    await page.getByRole('combobox', { name: /^Inbound format/ }).selectOption(format);
    await openSourceAdvanced(page);
    await page.locator('details[aria-label="Source validation settings"] > summary').click();
    await page.getByRole('radio', { name: 'Basic validation', exact: true }).check();
    await expect(page.getByLabel('Custom validation schema editor', { exact: true })).toHaveCount(
      0,
    );
    await step(page, 3);
    await page.getByRole('button', { name: 'Test Transformation', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
      'Test completed',
    );
    expect(
      captured(state, '/api/channel/preview-transformation')[0].body.configuration,
    ).toMatchObject({
      source: { inboundDataType: format },
      validationProfile: { basicSyntax: true },
    });
    await step(page, 3);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    expect(captured(state, '/api/channel/1')[0].body.validationProfile).toEqual({
      basicSyntax: true,
    });
    expect(state.externalRequests).toEqual([]);
  });

test('opening legacy Basic validation and response configuration preserves them without response editors', async ({
  page,
}) => {
  const legacy = { ...legacyChannel(), validationProfile: { jsonSchema: { type: 'object' } } };
  const state = await workspace(page, { channels: [legacy] });
  await openExisting(page);
  await openSourceAdvanced(page);
  await page.locator('details[aria-label="Source validation settings"] > summary').click();
  await expect(page.getByRole('radio', { name: 'Basic validation', exact: true })).toBeChecked();
  await expect(
    page.getByText('Legacy custom source response is active.', { exact: true }),
  ).toBeVisible();
  await step(page, 2);
  await page.getByText('Advanced destination settings', { exact: true }).click();
  await expect(
    page.getByText('Legacy custom destination response is active.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Response processing', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /response script|custom response/ })).toHaveCount(
    0,
  );
  await step(page, 3);
  await expect(
    page.getByRole('region', { name: 'Source processing summary', exact: true }),
  ).toContainText('Basic (existing JSON object schema)');
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel/1')[0].body).toMatchObject({
    validationProfile: legacy.validationProfile,
    responseScript: legacy.responseScript,
    processingScript: legacy.processingScript,
    destinations: legacy.destinations,
  });
});

test('Messages separates inbound, source and final output while auditing raw pagination', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  const result = page.getByRole('region', { name: 'Delivery Result', exact: true });
  await expect(result).toContainText('PATIENT_XML_RECEIVER');
  await expect(result).toContainText('XML');
  await expect(result).toContainText('HTTP 201');
  await expect(result.getByText('HTTP 200', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Technical details', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Payload', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inbound Message', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Source Processed Message', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('No source transformation', { exact: true })).toBeVisible();
  const delivery = page.getByRole('region', { name: 'Outbound delivery to PATIENT_XML_RECEIVER' });
  await expect(delivery).toContainText(xml);
  await expect(delivery).toContainText('XML');
  await expect(delivery).toContainText('OUT-SENT');
  await expect(delivery).toContainText('Synthetic destination accepted');
  await expect(page.getByText('SYNTHETIC EXAMPLE', { exact: false })).toHaveCount(0);
  await delivery.getByRole('button', { name: 'Copy Outbound Message', exact: true }).click();
  expect(await clipboard(page)).toBe(xml);
  await expect(
    page.getByText('Viewing raw payload will be recorded in the audit log.', { exact: true }),
  ).toBeVisible();
  expect(state.details.filter((request) => request.raw)).toHaveLength(0);
  await page.getByRole('button', { name: 'Next results', exact: true }).click();
  await expect(page.getByText('Results page 2', { exact: true })).toBeVisible();
  await expect(delivery).toContainText('REMOTE_HTTP_ERROR');
  await expect(delivery).toContainText('HTTP 503');
  await page.getByRole('button', { name: 'View raw (audited)', exact: true }).click();
  await expect(delivery).toContainText(rawXml);
  expect(state.details.at(-1)).toEqual({ id: 1, page: 2, raw: true });
  await page.getByRole('button', { name: 'Show redacted', exact: true }).click();
  await expect(delivery).toContainText(xml);
  expect(state.details.at(-1)).toEqual({ id: 1, page: 2, raw: false });
  await page.getByRole('tab', { name: 'Delivery history', exact: true }).click();
  await expect(page.getByText('Results page 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous results', exact: true }).click();
  await expect(page.getByText('Results page 1', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Direction', { exact: true }).selectOption('OUT');
  await page.getByRole('button', { name: 'Open message 2', exact: true }).click();
  await page.getByRole('tab', { name: 'Payload', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Outbound Message (stored)', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inbound Message', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Source Processed Message', exact: true }),
  ).toHaveCount(0);
});

test('Messages shows transport results to viewers without exposing payloads', async ({ page }) => {
  await workspace(page, { role: 'VIEWER' });
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  const result = page.getByRole('region', { name: 'Delivery Result', exact: true });
  await expect(result).toContainText('PATIENT_XML_RECEIVER');
  await expect(result).toContainText('HTTP 201');
  await expect(page.getByRole('tab', { name: 'Payload', exact: true })).toHaveCount(0);
  await expect(page.getByText('Synthetic destination accepted', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View raw (audited)', exact: true })).toHaveCount(
    0,
  );
});

test('Messages hides cached raw payload immediately when an active admin becomes a developer', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  await page.getByRole('tab', { name: 'Payload', exact: true }).click();
  await page.getByRole('button', { name: 'View raw (audited)', exact: true }).click();
  await expect(page.getByText('SYNTHETIC EXAMPLE', { exact: false }).first()).toBeVisible();
  let releaseRedacted: () => void = () => {};
  const waitForRelease = new Promise<void>((resolve) => {
    releaseRedacted = resolve;
  });
  await page.route('**/api/message/1?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('raw') === 'false') await waitForRelease;
    return route.fallback();
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: { success: true, data: { id: 1, name: 'Synthetic developer', role: 'DEVELOPER' } },
    }),
  );
  const maskedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/message/1' && url.searchParams.get('raw') === 'false';
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await maskedRequest;
  await expect(page.getByRole('button', { name: 'View raw (audited)', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('SYNTHETIC EXAMPLE', { exact: false })).toHaveCount(0);
  await expect(
    page.getByText('Refreshing the redacted message after your permissions changed.', {
      exact: true,
    }),
  ).toBeVisible();
  releaseRedacted();
  await expect(page.getByRole('heading', { name: 'Inbound Message', exact: true })).toBeVisible();
  await expect(page.getByText('SYNTHETIC EXAMPLE', { exact: false })).toHaveCount(0);
  expect(state.details.at(-1)).toEqual({ id: 1, page: 1, raw: false });
});

test('Messages leaves missing legacy HTTP results unknown', async ({ page }) => {
  await workspace(page);
  await page.route('**/api/message/1?*', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          id: 1,
          direction: 'IN',
          status: 'SUCCESS',
          channelId: 1,
          channelName: existingChannel.name,
          timestamp,
          inboundFormat: 'JSON',
          payloadAllowed: false,
          destinationLogs: [
            {
              messageId: 2,
              destinationName: 'Legacy receiver',
              outboundFormat: 'XML',
              connectorType: 'REST',
              status: 'OUT-SENT',
              sentAt: timestamp,
            },
          ],
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  const result = page.getByRole('region', { name: 'Delivery Result', exact: true });
  await expect(result).toContainText('Legacy receiver');
  await expect(result).toContainText('Not recorded');
  await expect(result.getByText(/HTTP \d+/)).toHaveCount(0);
});

test('raw preview and raw Messages controls follow the current role', async ({ page }) => {
  const state = await workspace(page, { role: 'DEVELOPER' });
  await newJsonXmlChannel(page);
  await preview(page);
  await expect(
    page.getByRole('checkbox', { name: 'Show unmasked preview (access is audited)' }),
  ).toHaveCount(0);
  expect(captured(state, '/api/channel/preview-transformation')[0].body.raw).toBe(false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  await page.getByRole('tab', { name: 'Payload', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View raw (audited)', exact: true })).toHaveCount(
    0,
  );
  expect(state.details.every((request) => !request.raw)).toBe(true);
});

test('administrator unmasked synthetic preview is explicit and never sends a delivery', async ({
  page,
}) => {
  const state = await workspace(page);
  await newJsonXmlChannel(page);
  await preview(page, true);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    rawXml,
  );
  expect(captured(state, '/api/channel/preview-transformation')[0].body.raw).toBe(true);
  expect(
    state.requests.filter((request) => request.path.startsWith('/api/message/inbound/')),
  ).toHaveLength(0);
  expect(state.externalRequests).toEqual([]);
});

test('manual field mappings save required defaults and test only after source and destination are complete', async ({
  page,
}) => {
  if (process.env.UI_REVIEW_TRANSFORMATION_SCREENSHOT || process.env.UI_REVIEW_REVIEW_SCREENSHOT)
    await page.setViewportSize({ width: 1440, height: 1600 });
  const state = await workspace(page, { channels: [] });
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_PATIENT_MAPPING');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await addPatientMappings(page);
  await page.locator('details[aria-label="Mapping options 3"] > summary').click();
  await page.getByLabel('Default value 3', { exact: true }).fill('U');
  await page.getByRole('checkbox', { name: 'Required field 3', exact: true }).check();
  await page.locator('details[aria-label="Mapping options 3"] > summary').click();
  await expect(page.getByLabel('XML root element', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Test Transformation', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Preview input', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  if (process.env.UI_REVIEW_TRANSFORMATION_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_REVIEW_TRANSFORMATION_SCREENSHOT });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Destination name').fill('PATIENT_XML_RECEIVER');
  await page.getByLabel('Outbound format', { exact: false }).selectOption('XML');
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
  const patient = {
    patient_id: 'SYNTHETIC-001',
    name: 'Example Patient',
    date_of_birth: '2000-01-01',
  };
  await preview(page, true, patient);
  const request = captured(state, '/api/channel/preview-transformation')[0];
  const configuration = request.body.configuration as {
    processingScript: string;
    destinations: { endpoint: string; name: string; outboundDataType: string }[];
  };
  const mapping = readFieldMapping(configuration.processingScript);
  expect(mapping).toEqual({
    version: 1,
    rows: [
      { source: 'patient_id', target: 'PatientID', required: true },
      { source: 'name', target: 'PatientName', required: true },
      { source: 'gender', target: 'Gender', required: true, defaultValue: 'U' },
      { source: 'date_of_birth', target: 'BirthDate', required: false },
    ],
  });
  expect(configuration.destinations[0]).toMatchObject({
    name: 'PATIENT_XML_RECEIVER',
    endpoint: receiver,
    outboundDataType: 'XML',
  });
  await expect(page.getByLabel('Integration flow')).toContainText('HTTP / JSON');
  await expect(page.getByLabel('Integration flow')).toContainText('4 field mappings');
  await expect(page.getByLabel('Integration flow')).toContainText('REST / XML');
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    mappedPatientXml.replace('<Patient>', '<root>').replace('</Patient>', '</root>'),
  );
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    'NOT SENT',
  );
  if (process.env.UI_REVIEW_REVIEW_SCREENSHOT) {
    await page.getByText('Advanced test options', { exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 2600 });
    await page
      .getByRole('dialog', { name: 'New channel', exact: true })
      .locator('.modal-body')
      .evaluate((element) => {
        element.scrollTop = 0;
      });
    await page.screenshot({ path: process.env.UI_REVIEW_REVIEW_SCREENSHOT });
  }
  await step(page, 1);
  await expect(page.getByLabel('Source Field 1', { exact: true })).toHaveValue('patient_id');
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = captured(state, '/api/channel').find((item) => item.method === 'POST')?.body;
  expect(readFieldMapping(String(saved?.processingScript))).toEqual(mapping);
  expect((saved?.destinations as { outboundDataType: string }[])[0].outboundDataType).toBe('XML');
  expect(state.externalRequests).toEqual([]);
  expect(captured(state, '/api/channel/test-connection')).toEqual([]);
});

test('unfinished field mappings block navigation and keep local input when going back', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await page.getByLabel('Source Field 1', { exact: true }).fill('patient_id');
  await expect(page.getByRole('button', { name: 'Test Transformation', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('Complete or remove the unfinished field mapping.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Source Field 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Source Field 1', { exact: true })).toHaveValue('patient_id');
  await expect(page.getByLabel('Target Field 1', { exact: true })).toHaveValue('');
  await step(page, 3);
  await expect(page.getByLabel('Source Field 1', { exact: true })).toBeVisible();
  expect(captured(state, '/api/channel/1')).toEqual([]);
  await page.getByLabel('Target Field 1', { exact: true }).fill('PatientID');
  await expect(page.getByRole('button', { name: 'Test Transformation', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await page.getByLabel('Source Field 2', { exact: true }).fill('name');
  await page.getByLabel('Target Field 2', { exact: true }).fill('PatientID');
  await expect(
    page.getByText('Mapping 2: output fields must not overlap.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove mapping 2', exact: true }).click();
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(
    readFieldMapping(String(captured(state, '/api/channel/1')[0].body.processingScript))?.rows,
  ).toEqual([{ source: 'patient_id', target: 'PatientID', required: false }]);
});

test('mixed destination formats routing scripts and retry survive transformation review unchanged', async ({
  page,
}) => {
  const multiple = {
    ...existingChannel,
    destinations: [
      { ...existingChannel.destinations[0], filterScript: 'return Boolean(msg.patient);' },
      {
        ...existingChannel.destinations[0],
        id: 2,
        name: 'SECONDARY_JSON_RECEIVER',
        outboundDataType: 'JSON',
        endpoint: `${receiver}?site=2`,
        filterScript: 'return true;',
        processingScript: 'return msg;',
        retryEnabled: true,
        maxRetries: 5,
        retryIntervalSeconds: 12,
        timeoutMs: 7000,
      },
    ],
  };
  const state = await workspace(page, { channels: [multiple] });
  await openExisting(page);
  await step(page, 1);
  await expect(page.getByRole('combobox', { name: /^Output format/ })).toHaveCount(0);
  await step(page, 2);
  await expect(page.getByLabel('Outbound format', { exact: false }).nth(0)).toHaveValue('XML');
  await expect(page.getByLabel('Outbound format', { exact: false }).nth(1)).toHaveValue('JSON');
  await expect(page.getByLabel('Destination name')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Add Destination', exact: true })).toBeVisible();
  await expect(page.getByLabel('Destination filter', { exact: true }).first()).not.toBeVisible();
  await step(page, 3);
  await expect(page.getByLabel('Integration flow')).toContainText('REST / XML');
  await expect(page.getByLabel('Integration flow')).toContainText('REST / JSON');
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel/1')[0].body).toMatchObject({
    destinations: multiple.destinations,
  });
});

test('legacy transformation script is replaced only after an explicit confirmation', async ({
  page,
}) => {
  const legacy = legacyChannel();
  const state = await workspace(page, { channels: [legacy] });
  await openExisting(page);
  await step(page, 1);
  await expect(
    page.getByText('A custom transformation is configured.', { exact: false }),
  ).toBeVisible();
  await page.getByText('Advanced Custom Transformation Script', { exact: false }).click();
  await page.getByRole('button', { name: 'Switch to field mapping', exact: true }).click();
  let confirmation = page.getByRole('dialog', { name: 'Switch to field mapping?', exact: true });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByText('A custom transformation is configured.', { exact: false }),
  ).toBeVisible();
  await preview(page);
  expect(
    (
      captured(state, '/api/channel/preview-transformation')[0].body.configuration as {
        processingScript: string;
      }
    ).processingScript,
  ).toBe(legacy.processingScript);
  await step(page, 1);
  await page.getByRole('button', { name: 'Switch to field mapping', exact: true }).click();
  confirmation = page.getByRole('dialog', { name: 'Switch to field mapping?', exact: true });
  await confirmation.getByRole('button', { name: 'Use field mapping', exact: true }).click();
  await page.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await page.getByLabel('Source Field 1', { exact: true }).fill('patient.identifier');
  await page.getByLabel('Target Field 1', { exact: true }).fill('PatientID');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = captured(state, '/api/channel/1')[0].body;
  expect(saved.processingScript).not.toBe(legacy.processingScript);
  expect(readFieldMapping(String(saved.processingScript))?.rows).toEqual([
    { source: 'patient.identifier', target: 'PatientID', required: false },
  ]);
  expect(saved.filterScript).toBe(legacy.filterScript);
  expect(saved.responseScript).toBe(legacy.responseScript);
  expect(saved.destinations).toMatchObject(legacy.destinations);
});

test('existing generated mappings are recognized and preserved without touching scripts', async ({
  page,
}) => {
  const script = compileFieldMapping({
    version: 1,
    rows: [
      {
        source: 'patient.identifier',
        target: 'PatientID',
        required: true,
        defaultValue: 'SYNTHETIC-UNKNOWN',
      },
    ],
    rootElement: 'Patient',
  });
  const channel = { ...existingChannel, processingScript: script };
  const state = await workspace(page, { channels: [channel] });
  await openExisting(page);
  await step(page, 1);
  await expect(page.getByLabel('Source Field 1', { exact: true })).toHaveValue(
    'patient.identifier',
  );
  await page.locator('details[aria-label="Mapping options 1"] > summary').click();
  await expect(page.getByLabel('Default value 1', { exact: true })).toHaveValue(
    'SYNTHETIC-UNKNOWN',
  );
  await expect(page.getByLabel('XML root element', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Switch to field mapping', exact: true }),
  ).toHaveCount(0);
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel/1')[0].body.processingScript).toBe(script);
});

test('four-step setup supports keyboard navigation mobile layout and accessible mapping fields', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page);
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  const inboundFormat = page.getByLabel('Inbound format');
  await inboundFormat.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New channel', exact: true })).toBeVisible();
  await expect(inboundFormat).toBeFocused();
  await expect(inboundFormat).toHaveValue('JSON');
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_ACCESSIBILITY');
  const advanced = page.locator('summary').filter({ hasText: 'Advanced source settings' });
  await advanced.focus();
  await page.keyboard.press('Enter');
  await page.locator('details[aria-label="Source filter settings"] > summary').click();
  await expect(page.getByRole('checkbox', { name: 'Enable source filter' })).toBeVisible();
  await page
    .locator('summary')
    .filter({ hasText: /^Validation/ })
    .click();
  await page.getByRole('radio', { name: 'Custom validation schema' }).check();
  await expect(page.getByLabel('Custom validation schema editor', { exact: false })).toBeVisible();
  let scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await addPatientMappings(page);
  scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  const dialog = page.getByRole('dialog', { name: 'New channel', exact: true });
  await dialog.getByLabel('Close dialog', { exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('test errors stay in Review and disappear when returning to mapping', async ({ page }) => {
  const state = await workspace(page);
  await openExisting(page);
  await step(page, 3);
  await page.getByRole('textbox', { name: /^Test input · JSON/ }).fill('{"patient_id":');
  await page.getByRole('button', { name: 'Test Transformation', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /JSON/i })).toBeVisible();
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  await step(page, 1);
  await expect(page.getByRole('heading', { name: 'Transformation', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /JSON/i })).toHaveCount(0);
  await expect(page.getByLabel('Test input', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await page.getByLabel('Source Field 1', { exact: true }).fill('patient_id');
  await page.getByLabel('Target Field 1', { exact: true }).fill('PatientID');
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
});

test('missing required mapping target shows the actionable server result in Review', async ({
  page,
}) => {
  const script = compileFieldMapping({
    version: 1,
    rows: [{ source: 'patient_id', target: 'PatientID', required: true }],
  });
  await workspace(page, { channels: [{ ...existingChannel, processingScript: script }] });
  let previewCalls = 0;
  await page.route('**/api/channel/preview-transformation', (route) => {
    previewCalls++;
    if (previewCalls > 1) return route.fallback();
    return route.fulfill({
      json: {
        success: false,
        accepted: false,
        elapsedMs: 2,
        networkDelivery: 'NOT_SENT',
        input: { format: 'JSON', payload: inbound },
        source: {
          format: 'JSON',
          payload: inbound,
          validation: 'PASSED',
          filter: 'ACCEPTED',
          transformation: 'ERROR',
          code: 'SCRIPT_EXECUTION_FAILED',
          message: 'Target field PatientID is required.',
        },
        results: [],
        warnings: [],
      },
    });
  });
  await openExisting(page);
  await step(page, 3);
  await page
    .getByRole('textbox', { name: /^Test input · JSON/ })
    .fill('{"name":"Synthetic Patient"}');
  await page.getByRole('button', { name: 'Test Transformation', exact: true }).click();
  const error = page.getByRole('alert').filter({ hasText: /PatientID/ });
  await expect(error).toBeVisible();
  await expect(error).toContainText('Target field PatientID is required.');
  await expect(error).not.toContainText('SCRIPT_EXECUTION_FAILED');
  expect(previewCalls).toBe(1);
  await page
    .getByRole('textbox', { name: /^Test input · JSON/ })
    .fill('{"patient_id":"SYNTHETIC-001"}');
  await page.getByRole('button', { name: 'Test Transformation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    'Test completed',
  );
  expect(previewCalls).toBe(2);
});

test('editing a mapping clears the previous review output and never tests automatically', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await preview(page, true);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    rawXml,
  );
  await step(page, 1);
  await page.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await page.getByLabel('Source Field 1', { exact: true }).fill('patient.identifier');
  await page.getByLabel('Target Field 1', { exact: true }).fill('PatientID');
  expect(captured(state, '/api/channel/preview-transformation')).toHaveLength(1);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  await step(page, 3);
  await expect(
    page.getByRole('region', { name: 'Generated output', exact: true }),
  ).not.toContainText(rawXml);
  expect(captured(state, '/api/channel/preview-transformation')).toHaveLength(1);
});

test('Review hides cached raw test output immediately after the administrator role changes', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await preview(page, true);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    rawXml,
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: { success: true, data: { id: 1, name: 'Synthetic developer', role: 'DEVELOPER' } },
    }),
  );
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/me',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expect(
    page.getByRole('checkbox', { name: 'Show unmasked preview (access is audited)' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Generated output', exact: true }),
  ).not.toContainText(rawXml);
  await page.getByRole('button', { name: 'Test Transformation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    xml,
  );
  expect(
    captured(state, '/api/channel/preview-transformation').map((request) => request.body.raw),
  ).toEqual([true, false]);
});
