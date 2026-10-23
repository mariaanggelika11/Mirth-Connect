import {
  readDestinationFilter,
  readSourceFilter,
  writeSourceFilter,
} from '../../server/src/utils/sourceFilter';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { compileFieldMapping, readFieldMapping } from '../../server/src/utils/fieldMapping';
import { defaultHl7Configuration } from '../../server/src/utils/hl7Configuration';
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
          rawPayload: !!body.raw,
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
            originalPayload: raw ? rawInbound : inbound,
            transformedPayload: id === 2 ? (raw ? rawXml : xml) : raw ? rawInbound : inbound,
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
async function openReviewTest(page: Page) {
  const section = page.locator('details[aria-label="Optional configuration test"]');
  if ((await section.getAttribute('open')) === null)
    await section.locator(':scope > summary').click();
}
async function openExisting(page: Page, name = existingChannel.name) {
  await page.getByLabel(`More actions for ${name}`).click();
  await page.getByRole('button', { name: 'Edit channel', exact: true }).click();
}
async function destinationSection(page: Page, name: string) {
  const section = page.locator(`details[aria-label="${name}"]`).first();
  if ((await section.getAttribute('open')) === null)
    await section.locator(':scope > summary').click();
  return section;
}
async function openSourceAdvanced(page: Page) {
  await page.getByText('Advanced source settings', { exact: true }).click();
  await page.locator('details[aria-label="Source filter settings"] > summary').click();
}
async function validationRule(page: Page, field = 'message_type') {
  await page.getByRole('radio', { name: 'Field validation', exact: true }).check();
  const rule = page.getByRole('group', { name: 'Validation rule 1', exact: true });
  await rule.getByLabel('Field', { exact: true }).fill(field);
  await rule.getByRole('checkbox', { name: 'Required', exact: true }).check();
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
async function preview(page: Page, payload: unknown = rawInbound) {
  await step(page, 3);
  await openReviewTest(page);
  await page.getByRole('textbox', { name: /^Test input · JSON/ }).fill(JSON.stringify(payload));
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    'Transformation successful',
  );
}
async function addSharedMapping(page: Page) {
  await page.getByRole('radio', { name: 'Modify fields', exact: true }).check();
  await page.getByRole('button', { name: 'Add Mapping', exact: true }).click();
}
async function addPatientMappings(page: Page) {
  const fields = [
    ['patient_id', 'PatientID'],
    ['name', 'PatientName'],
    ['gender', 'Gender'],
    ['date_of_birth', 'BirthDate'],
  ];
  await page.getByRole('radio', { name: 'Modify fields', exact: true }).check();
  for (const [index, [source, target]] of fields.entries()) {
    await addSharedMapping(page);
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
  await expect(page.getByRole('region', { name: 'Source authentication' })).toHaveCount(0);
  await expect(
    page.getByText(`${productionBase}/api/message/inbound/{channelId}`, { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Enable source filter' })).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Configure transformation', exact: true }).first(),
  ).not.toBeVisible();
  await expect(page.getByLabel('Duplicate message protection', { exact: false })).toHaveCount(0);
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_COMPACT_SETUP');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transformation', exact: true })).toBeVisible();
  await expect(
    page.getByText('The message will continue to destinations.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Input format', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /^Output format/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use patient example', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Run Test', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Test input', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'Show unmasked preview (access is audited)' }),
  ).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'No transformation', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Add Mapping', exact: true })).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Run Test', exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Change summary', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const onboarding = page.getByRole('dialog', { name: 'Channel saved', exact: true });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Create API key' })).toBeVisible();
  await expect(onboarding.getByRole('region', { name: 'Current source endpoint' })).toBeVisible();
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
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Each destination needs a name, endpoint and outbound format.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Destination name', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Destination name')).toBeVisible();
  await expect(page.getByLabel('Endpoint', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Destination name', { exact: true })).toBeFocused();
  await page.getByLabel('Destination name', { exact: true }).fill('SYNTHETIC_RECEIVER');
  await step(page, 3);
  await expect(page.getByLabel('Endpoint', { exact: false })).toBeFocused();
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
  await step(page, 3);
  await expect(page.getByRole('heading', { name: 'Review & Test', exact: true })).toBeVisible();
  await expect(page.getByText('Unnamed destination', { exact: true })).toHaveCount(0);
  expect(captured(state, '/api/channel').filter((request) => request.method === 'POST')).toEqual(
    [],
  );
});

test('direct wizard navigation requires the channel name and retains receive-only channels', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  const name = page.getByLabel('Channel name', { exact: false });
  for (const target of [1, 2, 3]) {
    await step(page, target);
    await expect(name).toBeVisible();
    await expect(name).toBeFocused();
    await expect(page.getByRole('alert')).toContainText('Give this channel a name');
  }
  await name.fill('SYNTHETIC_RECEIVE_ONLY');
  await step(page, 2);
  await page.getByRole('button', { name: 'Remove destination', exact: false }).click();
  await step(page, 3);
  await expect(page.getByLabel('Integration flow')).toContainText('Receive only');
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeVisible();
  expect(captured(state, '/api/channel')).toEqual([]);
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
});

test('Review keeps testing optional and shows output only after an explicit test', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const state = await workspace(page);
  await openExisting(page);
  await step(page, 3);
  const optional = page.locator('details[aria-label="Optional configuration test"]');
  const flow = page.getByLabel('Integration flow');
  await expect(optional).not.toHaveAttribute('open');
  await expect(page.getByRole('button', { name: 'Run Test', exact: true })).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  await expect(page.getByText('View details', { exact: true }).locator('..')).not.toHaveAttribute(
    'open',
  );
  expect((await flow.boundingBox())!.height).toBeLessThan(160);
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeInViewport();
  if (process.env.UI_COMPACT_REVIEW_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_COMPACT_REVIEW_SCREENSHOT });
  const summary = optional.locator(':scope > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: /^Test input · JSON/ });
  await expect(input).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load sample', exact: true })).not.toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Show unmasked preview (access is audited)' }),
  ).not.toBeVisible();
  await input.fill('{"patient_id":');
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The test payload is not valid JSON.');
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  await input.fill('{"patient_id":"SYNTHETIC-001"}');
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  const output = page.getByRole('region', { name: 'Generated output', exact: true });
  await expect(output).toContainText('No message was sent.');
  await expect(output).toContainText(rawXml);
  expect(captured(state, '/api/channel/preview-transformation')[0].body.raw).toBe(true);
  expect(
    captured(state, '/api/channel/preview-transformation')[0].body.configuration,
  ).not.toHaveProperty('changeSummary');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeInViewport();
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await summary.click();
  await expect(output).not.toBeVisible();
  await expect(optional).not.toHaveAttribute('open');
  expect(captured(state, '/api/channel/preview-transformation')).toHaveLength(1);
  expect(captured(state, '/api/channel/test-connection')).toEqual([]);
  expect(captured(state, '/api/channel/1')).toEqual([]);
  expect(state.externalRequests).toEqual([]);
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
  await openReviewTest(page);
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
  await expect(output).toContainText(rawXml);
  await output.getByRole('button', { name: 'Copy Output', exact: true }).click();
  expect(await clipboard(page)).toBe(rawXml);
  expect(
    captured(state, '/api/channel/preview-transformation').every(
      (request) => request.body.raw === true,
    ),
  ).toBe(true);
  await expect(page.getByText('Processing details', { exact: true })).toBeVisible();
  await page.getByText('Processing details', { exact: true }).click();
  const stages = page.getByRole('region', { name: 'Preview source processing', exact: true });
  await expect(stages).toBeVisible();
  await expect(stages).toContainText('Passed');
  await expect(stages).toContainText('Accepted');
  await expect(stages).toContainText('Pass-through');
  await expect(page.getByLabel('Output preview', { exact: true })).toContainText('NOT_SENT');
  expect(captured(state, '/api/channel/preview-transformation')[0].body).toMatchObject({
    raw: true,
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
  await expect(endpoint.getByRole('button', { name: 'Copy Endpoint', exact: true })).toBeVisible();
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
  await validationRule(page, 'message');
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
  await destinationSection(page, 'Delivery settings');
  await expect(page.getByRole('checkbox', { name: 'Automatic retry' })).not.toBeChecked();
  await destinationSection(page, 'Delivery settings');
  await page.getByRole('checkbox', { name: 'Automatic retry' }).check();
  await page.getByLabel('Retry attempts', { exact: true }).fill('4');
  await page.getByLabel('Retry interval (seconds)', { exact: true }).fill('15');
  await page.getByLabel('Request timeout (seconds)', { exact: true }).fill('2.5');
  await page.getByRole('checkbox', { name: 'Automatic retry' }).uncheck();
  await expect(page.getByLabel('Retry attempts', { exact: true })).toHaveCount(0);
  await destinationSection(page, 'Delivery settings');
  await page.getByRole('checkbox', { name: 'Automatic retry' }).check();
  await expect(page.getByLabel('Retry attempts', { exact: true })).toHaveValue('4');
  await preview(page);
  expect(captured(state, '/api/channel/preview-transformation')[0].body).toMatchObject({
    configuration: {
      validationProfile: {
        version: 1,
        mode: 'FIELDS',
        fieldRules: [{ field: 'message', type: 'text', required: true }],
      },
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
  ).not.toBeVisible();
  await step(page, 1);
  await expect(
    page
      .getByRole('region', { name: 'Shared transformation', exact: true })
      .getByText('A custom transformation is configured.', { exact: false }),
  ).toBeVisible();
  await step(page, 3);
  await expect(page.getByLabel('Change summary', { exact: false })).toHaveCount(0);
  await page.getByText('View details', { exact: true }).click();
  await expect(
    page.getByText('Legacy custom source response is active.', { exact: true }),
  ).toBeVisible();
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
  test(`${label} source endpoint uses the configured origin and supports safe copying`, async ({
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
    await endpoint.getByRole('button', { name: 'Copy Endpoint', exact: true }).click();
    expect(await clipboard(page)).toBe(`${base}/api/message/inbound/1`);
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
  await validationRule(page);
  await page.getByRole('checkbox', { name: 'Enable source filter' }).check();
  const sourceCondition = page.getByRole('group', {
    name: 'Source filter simple condition',
    exact: true,
  });
  await sourceCondition.getByLabel('Field', { exact: true }).fill('message_type');
  await sourceCondition.getByLabel('Value', { exact: true }).fill('ADT');
  await expect(page.getByLabel('Source filter script', { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-label="Source transformer settings"]')).toHaveCount(0);
  if (process.env.UI_FINAL_SOURCE_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_FINAL_SOURCE_SCREENSHOT });
  await step(page, 2);
  await page.getByText('Advanced destination settings', { exact: true }).click();
  const destinationAdvanced = page.locator('details[aria-label="Advanced destination settings"]');
  await expect(destinationAdvanced.locator(':scope > details > summary')).toHaveText([
    'Transformation',
    'Filter · Off',
    'Delivery',
  ]);
  await destinationSection(page, 'Destination filter settings');
  await page.getByRole('checkbox', { name: 'Enable destination filter', exact: true }).check();
  const destinationCondition = page.getByRole('group', {
    name: 'Destination filter simple condition',
    exact: true,
  });
  await destinationCondition.getByLabel('Field', { exact: true }).fill('department');
  await destinationCondition.getByLabel('Value', { exact: true }).fill('LAB');
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
  await page.getByText('View details', { exact: true }).click();
  const processing = page.getByRole('region', { name: 'Source processing summary', exact: true });
  await expect(processing).toContainText('1 required fields · 1 rules');
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
  expect(saved.validationProfile).toMatchObject({
    version: 1,
    mode: 'FIELDS',
    fieldRules: [{ field: 'message_type', type: 'text', required: true }],
  });
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
  await first.getByRole('checkbox', { name: 'Enable destination filter', exact: true }).check();
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
  test(`legacy Basic validation remains unchanged for ${format}`, async ({ page }) => {
    const state = await workspace(page, {
      channels: [
        {
          ...existingChannel,
          validationProfile: { basicSyntax: true },
          source: { ...existingChannel.source, inboundDataType: format },
        },
      ],
    });
    await openExisting(page);
    await openSourceAdvanced(page);
    await page.locator('details[aria-label="Source validation settings"] > summary').click();
    await expect(
      page.getByRole('radio', { name: 'Keep legacy validation', exact: true }),
    ).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Field validation', exact: true })).toBeDisabled();
    await expect(
      page.getByText('The existing rule checks message syntax and size.', { exact: false }),
    ).toBeVisible();
    await step(page, 3);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    expect(captured(state, '/api/channel/1')[0].body.validationProfile).toEqual({
      basicSyntax: true,
    });
  });

test('opening legacy Basic validation and response configuration preserves them without response editors', async ({
  page,
}) => {
  const legacy = { ...legacyChannel(), validationProfile: { jsonSchema: { type: 'object' } } };
  const state = await workspace(page, { channels: [legacy] });
  await openExisting(page);
  await openSourceAdvanced(page);
  await page.locator('details[aria-label="Source validation settings"] > summary').click();
  await expect(
    page.getByRole('radio', { name: 'Keep legacy validation', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByText('Legacy custom source response is active.', { exact: true }),
  ).not.toBeVisible();
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
  await page.getByText('View details', { exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Source processing summary', exact: true }),
  ).toContainText('Legacy JSON object check');
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
  await expect(delivery).toContainText(rawXml);
  await expect(delivery).toContainText('XML');
  await expect(delivery).toContainText('OUT-SENT');
  await expect(delivery).toContainText('Synthetic destination accepted');
  await expect(delivery).toContainText('SYNTHETIC EXAMPLE');
  await delivery.getByRole('button', { name: 'Copy Outbound Message', exact: true }).click();
  expect(await clipboard(page)).toBe(rawXml);
  await expect(page.getByRole('button', { name: 'View raw (audited)', exact: true })).toHaveCount(
    0,
  );
  expect(state.details).toEqual([{ id: 1, page: 1, raw: true }]);
  await page.getByRole('button', { name: 'Next results', exact: true }).click();
  await expect(page.getByText('Results page 2', { exact: true })).toBeVisible();
  await expect(delivery).toContainText('REMOTE_HTTP_ERROR');
  await expect(delivery).toContainText('HTTP 503');
  await expect(delivery).toContainText(rawXml);
  expect(state.details.at(-1)).toEqual({ id: 1, page: 2, raw: true });
  await page.getByRole('tab', { name: 'Delivery history', exact: true }).click();
  await expect(page.getByText('Results page 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous results', exact: true }).click();
  await expect(page.getByText('Results page 1', { exact: true })).toBeVisible();
  expect(state.details.every((request) => request.raw)).toBe(true);
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

test('administrator preview shows full payload automatically and never sends a delivery', async ({
  page,
}) => {
  const state = await workspace(page);
  await newJsonXmlChannel(page);
  await preview(page);
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
  await expect(page.getByRole('button', { name: 'Run Test', exact: true })).toHaveCount(0);
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
  await preview(page, patient);
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
    'No message was sent.',
  );
  if (process.env.UI_REVIEW_REVIEW_SCREENSHOT) {
    await page.getByText('Advanced test options', { exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 2600 });
    await page
      .getByRole('dialog', { name: 'New channel', exact: true })
      .locator('.editor-body')
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
  await expect(page.getByRole('dialog', { name: 'Channel saved', exact: true })).toBeVisible();
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
  await addSharedMapping(page);
  await page.getByLabel('Source Field 1', { exact: true }).fill('patient_id');
  await expect(page.getByRole('button', { name: 'Run Test', exact: true })).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Run Test', exact: true })).toHaveCount(0);
  await addSharedMapping(page);
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
    page
      .getByRole('region', { name: 'Shared transformation', exact: true })
      .getByText('A custom transformation is configured.', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Shared transformation', exact: true })
    .getByText('Advanced Custom Transformation Script', { exact: false })
    .click();
  await page.getByRole('button', { name: 'Switch to field mapping', exact: true }).click();
  let confirmation = page.getByRole('dialog', { name: 'Switch to field mapping?', exact: true });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Shared transformation', exact: true })
      .getByText('A custom transformation is configured.', { exact: false }),
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
  await addSharedMapping(page);
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
  await openReviewTest(page);
  await page.getByRole('textbox', { name: /^Test input · JSON/ }).fill('{"patient_id":');
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /JSON/i })).toBeVisible();
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  await step(page, 1);
  await expect(page.getByRole('heading', { name: 'Transformation', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /JSON/i })).toHaveCount(0);
  await expect(page.getByLabel('Test input', { exact: false })).toHaveCount(0);
  await addSharedMapping(page);
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
  await openReviewTest(page);
  await page
    .getByRole('textbox', { name: /^Test input · JSON/ })
    .fill('{"name":"Synthetic Patient"}');
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  const error = page.getByRole('alert').filter({ hasText: /PatientID/ });
  await expect(error).toBeVisible();
  await expect(error).toContainText('Target field PatientID is required.');
  await expect(error).not.toContainText('SCRIPT_EXECUTION_FAILED');
  expect(previewCalls).toBe(1);
  await page
    .getByRole('textbox', { name: /^Test input · JSON/ })
    .fill('{"patient_id":"SYNTHETIC-001"}');
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    'Transformation successful',
  );
  expect(previewCalls).toBe(2);
});

test('editing a mapping clears the previous review output and never tests automatically', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await preview(page);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    rawXml,
  );
  await step(page, 1);
  await addSharedMapping(page);
  await page.getByLabel('Source Field 1', { exact: true }).fill('patient.identifier');
  await page.getByLabel('Target Field 1', { exact: true }).fill('PatientID');
  expect(captured(state, '/api/channel/preview-transformation')).toHaveLength(1);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  await step(page, 3);
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  expect(captured(state, '/api/channel/preview-transformation')).toHaveLength(1);
});

test('Review hides cached raw test output immediately after the administrator role changes', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await preview(page);
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
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    xml,
  );
  expect(
    captured(state, '/api/channel/preview-transformation').map((request) => request.body.raw),
  ).toEqual([true, false]);
});

test('validation modes retain inactive rules and bare custom schema across create save and reopen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1500 });
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  await step(page, 0);
  await openSourceAdvanced(page);
  const validation = page.locator('details[aria-label="Source validation settings"]');
  await validation.locator(':scope > summary').click();
  await expect(
    page.getByRole('radio', { name: 'No additional validation', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByText('Only message parsing is applied. No additional field rules are configured.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Enable validation/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Field validation', exact: true }).check();
  const first = page.getByRole('group', { name: 'Validation rule 1', exact: true });
  await expect(first.getByLabel('Field', { exact: true })).toHaveValue('');
  await expect(validation.getByRole('alert')).toHaveCount(0);
  await expect(validation.locator(':scope > summary')).not.toContainText('Configured');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Rule 1:' }).first()).toBeVisible();
  await first.getByLabel('Field', { exact: true }).fill('patient_id');
  await first.getByRole('checkbox', { name: 'Required', exact: true }).check();
  await page.getByRole('button', { name: 'Add validation rule', exact: true }).click();
  const second = page.getByRole('group', { name: 'Validation rule 2', exact: true });
  await second.getByLabel('Field', { exact: true }).fill('date_of_birth');
  await second.getByRole('checkbox', { name: 'Required', exact: true }).uncheck();
  await second.getByRole('combobox', { name: 'Type', exact: true }).selectOption('date');
  await expect(validation).toContainText('1 required fields · 2 rules');
  if (process.env.UI_FIELD_VALIDATION_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_FIELD_VALIDATION_SCREENSHOT, fullPage: true });
  await page.getByRole('radio', { name: 'Custom validation schema', exact: true }).check();
  const schema = {
    type: 'object',
    properties: { age: { type: 'number' } },
    additionalProperties: true,
  };
  await page
    .getByLabel('Custom validation schema editor', { exact: true })
    .fill(JSON.stringify(schema, null, 2));
  await expect(validation.locator(':scope > summary')).not.toContainText('Configured');
  await page.getByRole('radio', { name: 'No additional validation', exact: true }).check();
  await expect(first).toHaveCount(0);
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel')[0].body.validationProfile).toMatchObject({
    version: 1,
    mode: 'NONE',
    fieldRules: [
      { field: 'patient_id', type: 'text', required: true },
      { field: 'date_of_birth', type: 'date', required: false },
    ],
    custom: { jsonSchema: schema },
  });
  await page
    .getByRole('dialog', { name: 'Channel saved', exact: true })
    .getByLabel('Close dialog')
    .click();
  await openExisting(page, 'SYNTHETIC_JSON_TO_XML');
  await openSourceAdvanced(page);
  await page.locator('details[aria-label="Source validation settings"] > summary').click();
  await expect(
    page.getByRole('radio', { name: 'No additional validation', exact: true }),
  ).toBeChecked();
  await page.getByRole('radio', { name: 'Field validation', exact: true }).check();
  await expect(first.getByLabel('Field', { exact: true })).toHaveValue('patient_id');
  await expect(second.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('date');
  await page.getByRole('radio', { name: 'Custom validation schema', exact: true }).check();
  await expect(page.getByLabel('Custom validation schema editor', { exact: true })).toHaveValue(
    JSON.stringify(schema, null, 2),
  );
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const format of ['JSON', 'XML', 'HL7V2'] as const)
  test(`custom ${format} validation has an explicit applicable example`, async ({ page }) => {
    if (process.env.UI_CUSTOM_VALIDATION_SCREENSHOT)
      await page.setViewportSize({ width: 1280, height: 1400 });
    const state = await workspace(page);
    await openExisting(page);
    await page.getByRole('combobox', { name: /^Inbound format/ }).selectOption(format);
    await openSourceAdvanced(page);
    const validation = page.locator('details[aria-label="Source validation settings"]');
    await validation.locator(':scope > summary').click();
    if (format !== 'JSON')
      await expect(
        page.getByRole('radio', { name: 'Field validation', exact: true }),
      ).toBeDisabled();
    await page.getByRole('radio', { name: 'Custom validation schema', exact: true }).check();
    await page.getByText('Example configuration', { exact: true }).click();
    await page.getByRole('button', { name: 'Use example', exact: true }).click();
    const editor = page.getByLabel('Custom validation schema editor', { exact: true });
    const custom = JSON.parse(await editor.inputValue());
    expect(custom).toHaveProperty(
      format === 'JSON' ? 'properties' : format === 'XML' ? 'requiredPaths' : 'requiredFields',
    );
    if (format === 'JSON' && process.env.UI_CUSTOM_VALIDATION_SCREENSHOT)
      await page.screenshot({ path: process.env.UI_CUSTOM_VALIDATION_SCREENSHOT, fullPage: true });
    await step(page, 3);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    expect(captured(state, '/api/channel/1')[0].body.validationProfile).toMatchObject({
      version: 1,
      mode: 'CUSTOM',
      custom: { [format === 'JSON' ? 'jsonSchema' : format === 'XML' ? 'xml' : 'hl7']: custom },
    });
    expect(state.externalRequests).toEqual([]);
  });

test('Review displays failed input rules with skipped filter transformation and no outbound delivery', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await openSourceAdvanced(page);
  await page.locator('details[aria-label="Source validation settings"] > summary').click();
  await validationRule(page, 'patient_id');
  await page.route('**/api/channel/preview-transformation', (route) =>
    route.fulfill({
      json: {
        success: false,
        accepted: false,
        elapsedMs: 2,
        networkDelivery: 'NOT_SENT',
        input: { format: 'JSON', payload: '[REDACTED]' },
        source: {
          format: 'JSON',
          payload: null,
          validation: 'ERROR',
          filter: 'SKIPPED',
          transformation: 'SKIPPED',
          code: 'FIELD_VALIDATION_FAILED',
          message: 'Input fields do not meet the configured validation rules.',
          validationResults: [
            {
              field: 'patient_id',
              type: 'text',
              required: true,
              status: 'FAILED',
              code: 'REQUIRED',
              message: 'Required value is missing.',
            },
          ],
        },
        results: [],
        warnings: [],
      },
    }),
  );
  await step(page, 3);
  await openReviewTest(page);
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  const output = page.getByRole('region', { name: 'Generated output', exact: true });
  await expect(output).toContainText('Input fields do not meet');
  await page.getByText('Advanced test options', { exact: true }).click();
  await page.getByText('Processing details', { exact: true }).click();
  const diagnostic = page.getByLabel('Output preview', { exact: true });
  await expect(diagnostic).toContainText('patient_id');
  await expect(diagnostic).toContainText('Required value is missing.');
  await expect(diagnostic).toContainText('Not run');
  await expect(diagnostic).toContainText('NOT_SENT');
  expect(captured(state, '/api/channel/test-connection')).toEqual([]);
  expect(state.externalRequests).toEqual([]);
});

async function destinationAdvanced(page: Page) {
  await step(page, 2);
  const destination = page.locator('.destination-editor').first();
  await destination.getByText('Advanced destination settings', { exact: true }).click();
  await destinationSection(page, 'Destination filter settings');
  return destination;
}

test('destination filter retains its exact rule while OFF across save and reopen', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  const destination = await destinationAdvanced(page);
  const filter = destination.getByRole('group', {
    name: 'Destination filter settings',
    exact: true,
  });
  const enabled = filter.getByRole('checkbox', { name: 'Enable destination filter', exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await expect(filter).not.toContainText('Configured');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Complete the filter condition' }),
  ).toBeVisible();
  await filter.getByLabel('Field', { exact: true }).fill('patient.department');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Complete the filter condition' }),
  ).toBeVisible();
  await filter.getByLabel('Value', { exact: true }).fill('LAB');
  await expect(
    destination.locator('details[aria-label="Advanced destination settings"] > summary'),
  ).toContainText('Customized');
  await enabled.uncheck();
  await expect(filter.getByLabel('Field', { exact: true })).not.toBeVisible();
  await expect(enabled).not.toBeChecked();
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = (
    captured(state, '/api/channel')[0].body.destinations as { filterScript: string }[]
  )[0];
  const retained = readDestinationFilter(saved.filterScript);
  expect(retained.enabled).toBe(false);
  expect(readSimpleCondition(retained.rule)).toMatchObject({
    field: 'patient.department',
    value: 'LAB',
  });
  await page
    .getByRole('dialog', { name: 'Channel saved', exact: true })
    .getByLabel('Close dialog')
    .click();
  await openExisting(page, 'SYNTHETIC_JSON_TO_XML');
  await destinationAdvanced(page);
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await expect(filter.getByLabel('Field', { exact: true })).toHaveValue('patient.department');
  await expect(filter.getByLabel('Value', { exact: true })).toHaveValue('LAB');
  await filter.getByLabel('Operator', { exact: true }).selectOption('isEmpty');
  await expect(filter.getByLabel('Value', { exact: true })).toHaveCount(0);
  expect(state.externalRequests).toEqual([]);
});

for (const [label, script] of [
  ['deliver', 'return true;'],
  ['skip', 'return false;'],
  ['bare skip', 'false'],
  ['custom', 'return msg.department === "LAB";'],
] as const)
  test(`legacy destination ${label} remains read-only and unchanged on save`, async ({ page }) => {
    const state = await workspace(page, {
      channels: [
        {
          ...existingChannel,
          destinations: [{ ...existingChannel.destinations[0], filterScript: script }],
        },
      ],
    });
    await openExisting(page);
    const destination = await destinationAdvanced(page);
    const filter = destination.getByRole('group', {
      name: 'Destination filter settings',
      exact: true,
    });
    await expect(filter).toContainText('Legacy destination filter retained');
    await expect(filter.getByRole('combobox')).toHaveCount(0);
    await expect(filter.locator('textarea')).toHaveCount(0);
    const enabled = filter.getByRole('checkbox', {
      name: 'Enable destination filter',
      exact: true,
    });
    await enabled.uncheck();
    await enabled.check();
    await expect(filter).toContainText('Legacy destination filter retained');
    await step(page, 3);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    expect(
      (captured(state, '/api/channel/1')[0].body.destinations as { filterScript: string }[])[0]
        .filterScript,
    ).toBe(script);
  });

test('destination mapping uses the existing editor and preserves legacy output script', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  const template = 'return { Envelope: msg };';
  const state = await workspace(page, {
    channels: [
      {
        ...existingChannel,
        destinations: [{ ...existingChannel.destinations[0], templateScript: template }],
      },
    ],
  });
  await openExisting(page);
  const destination = await destinationAdvanced(page);
  await expect(destination.getByRole('button', { name: 'Add template', exact: true })).toHaveCount(
    0,
  );
  await destination
    .locator('details[aria-label="Destination transformation settings"] > summary')
    .click();
  const dialog = page.getByRole('region', {
    name: 'Transformation · PATIENT_XML_RECEIVER',
    exact: true,
  });
  await dialog.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await dialog.getByLabel('Source Field 1', { exact: true }).fill('patient_id');
  await dialog.getByLabel('Target Field 1', { exact: true }).fill('patientCode');
  await dialog.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await dialog.getByLabel('Source Field 2', { exact: true }).fill('name');
  await dialog.getByLabel('Target Field 2', { exact: true }).fill('fullName');
  await destination
    .locator('details[aria-label="Legacy destination output script"] > summary')
    .click();
  await expect(destination).toContainText('Its return value replaces the outbound payload');
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  if (process.env.UI_DESTINATION_MAPPING_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_DESTINATION_MAPPING_SCREENSHOT });
  await destination.getByRole('button', { name: 'Edit legacy output script', exact: true }).click();
  const scriptDialog = page.getByRole('dialog').last();
  await expect(scriptDialog.locator('textarea')).toHaveValue(template);
  await scriptDialog.getByLabel('Close dialog').click();
  await destination
    .locator('details[aria-label="Destination transformation settings"] > summary')
    .click();
  await expect(dialog.getByLabel('Target Field 2', { exact: true })).toHaveValue('fullName');
  await destination
    .locator('details[aria-label="Destination transformation settings"] > summary')
    .click();
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = (
    captured(state, '/api/channel/1')[0].body.destinations as {
      processingScript: string;
      templateScript: string;
    }[]
  )[0];
  expect(saved.templateScript).toBe(template);
  expect(readFieldMapping(saved.processingScript)?.rows).toEqual([
    { source: 'patient_id', target: 'patientCode', required: false },
    { source: 'name', target: 'fullName', required: false },
  ]);
  expect(state.externalRequests).toEqual([]);
});

test('unfinished destination mapping survives collapsing its editor and blocks review until corrected', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  const destination = await destinationAdvanced(page);
  const configure = destination.locator(
    'details[aria-label="Destination transformation settings"] > summary',
  );
  await configure.click();
  const dialog = page.getByRole('region', {
    name: 'Transformation · PATIENT_XML_RECEIVER',
    exact: true,
  });
  await dialog.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await dialog.getByLabel('Source Field 1', { exact: true }).fill('patient_id');
  await destination
    .locator('details[aria-label="Destination transformation settings"] > summary')
    .click();
  await step(page, 3);
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Complete or remove the unfinished field mapping for destination 1' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Source Field 1', { exact: true })).toHaveValue('patient_id');
  await dialog.getByLabel('Target Field 1', { exact: true }).fill('patientCode');
  await destination
    .locator('details[aria-label="Destination transformation settings"] > summary')
    .click();
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel/1')).toHaveLength(1);
});

test('review labels filtered and disabled destinations without claiming transformation or delivery', async ({
  page,
}) => {
  await workspace(page);
  await page.route('**/api/channel/preview-transformation', (route) =>
    route.fulfill({
      json: {
        success: true,
        accepted: true,
        elapsedMs: 2,
        networkDelivery: 'NOT_SENT',
        source: {
          format: 'JSON',
          payload: {},
          validation: 'PASSED',
          filter: 'ACCEPTED',
          transformation: 'PASS_THROUGH',
        },
        results: [
          {
            name: 'LAB_RECEIVER',
            enabled: true,
            status: 'FILTERED',
            routed: false,
            outputFormat: 'XML',
            delivery: 'FILTERED',
            stages: {
              filter: 'NOT_MATCHED',
              transformation: 'NOT_RUN',
              template: 'NOT_RUN',
              conversion: 'NOT_RUN',
            },
          },
          {
            name: 'DISABLED_RECEIVER',
            enabled: false,
            status: 'SKIPPED',
            routed: false,
            outputFormat: 'JSON',
            delivery: 'DISABLED',
            stages: {
              filter: 'NOT_RUN',
              transformation: 'NOT_RUN',
              template: 'NOT_RUN',
              conversion: 'NOT_RUN',
            },
          },
        ],
      },
    }),
  );
  await openExisting(page);
  await preview(page);
  const output = page.getByRole('region', { name: 'Generated output', exact: true });
  await expect(output.getByLabel('Processing results: LAB_RECEIVER')).toHaveCount(0);
  await page.getByText('Advanced test options', { exact: true }).click();
  await page.getByText('Processing details', { exact: true }).click();
  const diagnostics = page.getByLabel('Output preview', { exact: true });
  await expect(diagnostics.getByLabel('Processing results: LAB_RECEIVER')).toContainText(
    'Not matched',
  );
  await expect(diagnostics.getByLabel('Processing results: LAB_RECEIVER')).toContainText('Not run');
  await expect(output).toContainText('No message was sent to this destination');
  await expect(diagnostics.getByLabel('Processing results: DISABLED_RECEIVER')).toContainText(
    'Destination disabled',
  );
  await expect(output).not.toContainText('Delivery success');
});

test('Messages distinguishes filtering disabled and preparation errors with zero network attempts', async ({
  page,
}) => {
  await workspace(page);
  await page.route('**/api/message/1?*', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          id: 1,
          direction: 'IN',
          status: 'PARTIAL',
          channelId: 1,
          channelName: existingChannel.name,
          timestamp,
          payloadAllowed: true,
          destinationLogs: [],
          destinationOutcomes: [
            {
              destinationId: 1,
              name: 'Filtered LAB',
              enabled: true,
              status: 'FILTERED',
              filter: 'NOT_MATCHED',
              transformation: 'NOT_RUN',
              template: 'NOT_RUN',
              conversion: 'NOT_RUN',
              delivery: 'FILTERED',
              occurredAt: timestamp,
              attemptCount: 0,
            },
            {
              destinationId: 2,
              name: 'Disabled RIS',
              enabled: false,
              status: 'DISABLED',
              filter: 'NOT_RUN',
              transformation: 'NOT_RUN',
              template: 'NOT_RUN',
              conversion: 'NOT_RUN',
              delivery: 'DISABLED',
              occurredAt: timestamp,
              attemptCount: 0,
            },
            {
              destinationId: 3,
              name: 'Broken mapping',
              enabled: true,
              status: 'OUT-ERROR',
              filter: 'MATCHED',
              transformation: 'ERROR',
              template: 'NOT_RUN',
              conversion: 'NOT_RUN',
              delivery: 'NOT_SENT',
              code: 'FIELD_MAPPING_INVALID',
              occurredAt: timestamp,
              attemptCount: 0,
            },
          ],
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  const result = page.getByRole('region', { name: 'Destination processing', exact: true });
  await expect(result).toContainText('Filtered LAB');
  await expect(result).toContainText('Filtered · not sent');
  await expect(result).toContainText('Disabled RIS');
  await expect(result).toContainText('FIELD_MAPPING_INVALID');
  await expect(result.getByText('Network attempts', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Delivery Result', exact: true })).toContainText(
    'No network delivery attempts recorded.',
  );
  await expect(result).not.toContainText('HTTP 200');
});

test('replacing a legacy destination filter requires an explicit complete condition', async ({
  page,
}) => {
  const state = await workspace(page, {
    channels: [
      {
        ...existingChannel,
        destinations: [{ ...existingChannel.destinations[0], filterScript: 'return false;' }],
      },
    ],
  });
  await openExisting(page);
  const destination = await destinationAdvanced(page);
  const filter = destination.getByRole('group', {
    name: 'Destination filter settings',
    exact: true,
  });
  await filter.getByRole('button', { name: 'Replace with simple condition', exact: true }).click();
  await expect(
    filter.getByRole('group', { name: 'Destination filter simple condition', exact: true }),
  ).toBeVisible();
  await step(page, 3);
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
  await filter.getByLabel('Field', { exact: true }).fill('department');
  await filter.getByLabel('Value', { exact: true }).fill('LAB');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(
    readSimpleCondition(
      (captured(state, '/api/channel/1')[0].body.destinations as { filterScript: string }[])[0]
        .filterScript,
    ),
  ).toMatchObject({ field: 'department', operator: 'eq', value: 'LAB' });
  expect(state.externalRequests).toEqual([]);
});

test('Source has no sample controls and mapping works with test input only in Review', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await expect(page.getByText('Sample message (optional)', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analyze fields', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Source sample · JSON', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load JSON example', exact: true })).toHaveCount(0);
  await step(page, 1);
  await addSharedMapping(page);
  const source = page.getByLabel('Source Field 1', { exact: true });
  await source.fill('patient_id');
  await page.getByLabel('Target Field 1', { exact: true }).fill('PatientID');
  await step(page, 3);
  await openReviewTest(page);
  const input = page.getByRole('textbox', { name: /^Test input · JSON/ });
  const sample = JSON.stringify({ patient_id: 'SYNTHETIC-001' });
  await input.fill(sample);
  await page.getByRole('button', { name: 'Run Test', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toContainText(
    'Transformation successful',
  );
  expect(captured(state, '/api/channel/preview-transformation')[0].body.payload).toEqual({
    patient_id: 'SYNTHETIC-001',
  });
  await step(page, 0);
  await expect(page.getByText('Sample message (optional)', { exact: true })).toHaveCount(0);
  await step(page, 1);
  await expect(source).toHaveValue('patient_id');
  await expect(page.getByLabel('Target Field 1', { exact: true })).toHaveValue('PatientID');
  await step(page, 3);
  await openReviewTest(page);
  await expect(input).toHaveValue(sample);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = captured(state, '/api/channel/1')[0].body;
  expect(saved).not.toHaveProperty('sample');
  expect(saved).not.toHaveProperty('payload');
  expect(readFieldMapping(saved.processingScript as string)?.rows).toMatchObject([
    { source: 'patient_id', target: 'PatientID' },
  ]);
  expect(captured(state, '/api/channel/discover-fields')).toEqual([]);
  expect(state.externalRequests).toEqual([]);
});

test('blank mapping rows are harmless while partial paths get specific inline guidance', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await step(page, 1);
  await addSharedMapping(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await step(page, 3);
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeVisible();
  await step(page, 1);
  await page.getByLabel('Source Field 1', { exact: true }).fill('patient.id');
  await expect(page.getByRole('alert').filter({ hasText: 'Target Field' })).toBeVisible();
  await step(page, 3);
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
  await page.getByLabel('Target Field 1', { exact: true }).fill('patientId');
  await page.locator('details[aria-label="Mapping options 1"] > summary').click();
  await page.getByRole('combobox', { name: 'Type conversion 1', exact: true }).selectOption('TEXT');
  await page.getByLabel('Default value 1', { exact: true }).fill('SYNTHETIC-DEFAULT');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(
    readFieldMapping(String(captured(state, '/api/channel/1')[0].body.processingScript)),
  ).toMatchObject({
    version: 2,
    rows: [
      {
        source: 'patient.id',
        target: 'patientId',
        conversion: 'TEXT',
        defaultValue: 'SYNTHETIC-DEFAULT',
      },
    ],
  });
});

async function hl7Destination(page: Page) {
  await step(page, 2);
  await page.getByLabel('Outbound format', { exact: false }).first().selectOption('HL7V2');
  const editor = page.getByRole('region', { name: 'HL7 destination mapping', exact: true }).first();
  await expect(editor).toBeVisible();
  const advanced = editor.locator('details[aria-label="Advanced destination settings"]');
  await expect(advanced).not.toHaveAttribute('open');
  await expect(editor.getByRole('combobox', { name: 'Message type', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('table', { name: 'HL7 field mappings' })).toHaveCount(0);
  await advanced.locator(':scope > summary').click();
  await destinationSection(page, 'Destination transformation settings');
  await expect(page.getByRole('dialog', { name: /^Transformation ·/ })).toHaveCount(0);
  return editor;
}

async function selectHl7Target(editor: ReturnType<Page['locator']>, index: number, path: string) {
  const trigger = editor.getByRole('button', { name: `Target Field ${index}`, exact: true });
  await trigger.click();
  const choices = editor.getByRole('region', {
    name: `Target Field ${index} choices`,
    exact: true,
  });
  await choices.getByLabel('Search fields', { exact: true }).fill(path.replace('.', '-'));
  const branch = choices.getByRole('button', { name: `Select ${path}`, exact: true });
  if (await branch.count()) await branch.click();
  else
    await choices
      .getByRole('button', {
        name: new RegExp(`^${path.replace('.', '-').replaceAll('.', '\\.')} —`),
      })
      .click();
  await expect(choices).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

test('destination HL7 configuration saves version headers mappings and conversion then reopens intact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  const dialog = await hl7Destination(page);
  await expect(dialog.locator('output[aria-label="HL7 version"]')).toHaveText('2.5');
  await expect(dialog.getByRole('combobox', { name: 'Message type', exact: true })).toHaveValue(
    'ADT^A04',
  );
  await dialog.getByText('HL7 settings', { exact: true }).click();
  await expect(
    dialog.getByRole('textbox', { name: /^Message date\/time|^Message control ID/ }),
  ).toHaveCount(0);
  await dialog.getByLabel('Sending application', { exact: true }).fill('SYNTHETIC_SOURCE');
  const rows = [
    ['patient_id', 'PID.3', 'NONE'],
    ['last_name', 'PID.5.1', 'NONE'],
    ['first_name', 'PID.5.2', 'NONE'],
    ['dob', 'PID.7', 'DATE_TO_HL7'],
  ];
  for (const [index, [source, target, conversion]] of rows.entries()) {
    await dialog.getByRole('button', { name: 'Add Mapping', exact: true }).click();
    await dialog.getByLabel(`Source Field ${index + 1}`, { exact: true }).fill(source);
    await selectHl7Target(dialog, index + 1, target);
    if (conversion !== 'NONE') {
      await dialog.locator(`details[aria-label="Mapping options ${index + 1}"] > summary`).click();
      await dialog
        .getByRole('combobox', { name: `Type conversion ${index + 1}`, exact: true })
        .selectOption(conversion);
    }
  }
  await dialog.getByRole('button', { name: 'Target Field 1', exact: true }).click();
  const choices = dialog.getByRole('region', { name: 'Target Field 1 choices', exact: true });
  await choices.getByLabel('Search fields', { exact: true }).fill('Patient identifier');
  await expect(choices).toContainText('PID-3');
  await choices.getByRole('button', { name: 'Select PID.3', exact: true }).click();
  await dialog.getByText('HL7 settings', { exact: true }).click();
  await page.getByText('Advanced destination settings', { exact: true }).click();
  if (process.env.UI_HL7_MAPPING_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_HL7_MAPPING_SCREENSHOT });
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1400 });
  await step(page, 3);
  await page.getByText('View details', { exact: true }).click();
  await expect(page.getByText('ADT^A04 · 2.5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = (
    captured(state, '/api/channel')[0].body.destinations as { processingScript: string }[]
  )[0];
  expect(readFieldMapping(saved.processingScript)).toMatchObject({
    version: 2,
    hl7: { version: '2.5', messageType: 'ADT^A04', sendingApplication: 'SYNTHETIC_SOURCE' },
    rows: expect.arrayContaining([
      { source: 'dob', target: 'PID.7', required: false, conversion: 'DATE_TO_HL7' },
    ]),
  });
  await page
    .getByRole('dialog', { name: 'Channel saved', exact: true })
    .getByLabel('Close dialog')
    .click();
  await openExisting(page, 'SYNTHETIC_JSON_TO_XML');
  await step(page, 2);
  await expect(dialog.getByRole('table', { name: 'HL7 field mappings' })).toHaveCount(0);
  await page.getByText('Advanced destination settings', { exact: true }).click();
  await destinationSection(page, 'Destination transformation settings');
  await expect(dialog.getByLabel('Source Field 4', { exact: true })).toHaveValue('dob');
  await expect(dialog.getByRole('combobox', { name: 'Message type', exact: true })).toHaveValue(
    'ADT^A04',
  );
  expect(state.externalRequests).toEqual([]);
});

test('compact JSON to HL7 mapping skips optional source mapping and keeps advanced settings closed', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  await step(page, 1);
  await addSharedMapping(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const editor = await hl7Destination(page);
  await expect(editor.getByRole('table', { name: 'HL7 field mappings' })).toBeVisible();
  await expect(editor.getByLabel('Sending application', { exact: true })).not.toBeVisible();
  await expect(editor.getByRole('region', { name: /Target Field/ })).toHaveCount(0);
  const rows = [
    ['patient_id', 'PID.3.1'],
    ['name', 'PID.5'],
    ['birth_date', 'PID.7'],
    ['gender', 'PID.8'],
  ];
  for (const [index, [source, target]] of rows.entries()) {
    await editor.getByRole('button', { name: 'Add Mapping', exact: true }).click();
    await editor.getByLabel(`Source Field ${index + 1}`, { exact: true }).fill(source);
    if (index === 0) {
      await expect(editor.getByRole('alert')).toHaveCount(1);
      await expect(editor.getByRole('alert')).toContainText('select or enter a Target Field');
    }
    await selectHl7Target(editor, index + 1, target);
  }
  await expect(editor).toContainText('Full text; no name splitting');
  await expect(editor).toContainText('YYYY-MM-DD → YYYYMMDD');
  if (process.env.UI_HL7_COMPACT_SCREENSHOT) {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page
      .getByRole('dialog', { name: 'New channel', exact: true })
      .locator('.editor-body')
      .evaluate((element) => {
        element.scrollTop = 0;
      });
    await page.screenshot({ path: process.env.UI_HL7_COMPACT_SCREENSHOT });
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await editor.getByRole('button', { name: 'Target Field 4', exact: true }).click();
  await expect(
    editor.getByRole('region', { name: 'Target Field 4 choices', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole('button', { name: 'Target Field 4', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  const trigger = editor.getByRole('button', { name: 'Target Field 1', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const choices = editor.getByRole('region', { name: 'Target Field 1 choices', exact: true });
  await expect(choices.getByLabel('Search fields', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(choices).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(editor).toBeVisible();
  // Empty extra rows must not block saving or produce an empty stored mapping.
  await editor.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const body = captured(state, '/api/channel')[0].body;
  expect(body.processingScript).toBe('');
  const mapping = readFieldMapping(
    (body.destinations as { processingScript: string }[])[0].processingScript,
  );
  expect(mapping?.rows).toHaveLength(4);
  expect(mapping?.rows[2]).toMatchObject({
    source: 'birth_date',
    target: 'PID.7',
    conversion: 'DATE_TO_HL7',
  });
  expect(state.externalRequests).toEqual([]);
});

test('HL7 target tree expands only on request and retains explicit advanced repeated paths', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  const editor = await hl7Destination(page);
  await editor.getByRole('combobox', { name: 'Message type', exact: true }).selectOption('ORU^R01');
  await editor.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await editor.getByLabel('Source Field 1', { exact: true }).fill('observations[1].value');
  await editor.getByRole('button', { name: 'Target Field 1', exact: true }).click();
  const choices = editor.getByRole('region', { name: 'Target Field 1 choices', exact: true });
  const pid = choices
    .locator('details')
    .filter({ has: page.locator(':scope > summary', { hasText: 'PID — Patient identification' }) })
    .first();
  await expect(pid).not.toHaveAttribute('open');
  await pid.locator(':scope > summary').focus();
  await page.keyboard.press('Space');
  await expect(pid).toHaveAttribute('open', '');
  await editor.getByText('Advanced field path', { exact: true }).click();
  await editor.getByLabel('Custom Target Field 1', { exact: true }).fill('OBX[1].5');
  await editor.getByRole('button', { name: 'Use field path', exact: true }).click();
  await expect(choices).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Target Field 1', exact: true })).toContainText(
    'OBX[1]-5',
  );
  await expect(editor.getByRole('alert')).toContainText(
    'consecutive repeating HL7 segment indexes starting at 0',
  );
  await editor.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await editor.getByLabel('Source Field 2', { exact: true }).fill('observations[0].value');
  await editor.getByRole('button', { name: 'Target Field 2', exact: true }).click();
  await editor.getByText('Advanced field path', { exact: true }).click();
  await editor.getByLabel('Custom Target Field 2', { exact: true }).fill('OBX[0].5');
  await editor.getByRole('button', { name: 'Use field path', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = captured(state, '/api/channel/1')[0].body.destinations as {
    processingScript: string;
  }[];
  expect(readFieldMapping(saved[0].processingScript)?.rows[0].target).toBe('OBX[1].5');
});

for (const [type, required] of [
  ['ADT^A01', 'PID-3'],
  ['ORU^R01', 'OBX-5'],
  ['ORM^O01', 'ORC-2'],
] as const)
  test(`HL7 ${type} offers its actual curated template fields`, async ({ page }) => {
    await workspace(page);
    await openExisting(page);
    const dialog = await hl7Destination(page);
    await dialog.getByRole('combobox', { name: 'Message type', exact: true }).selectOption(type);
    await expect(dialog.getByText('Template structure and fields', { exact: true })).toHaveCount(0);
    await expect(dialog.locator('output[aria-label="HL7 version"]')).toHaveText('2.5');
    await expect(dialog.getByRole('combobox', { name: 'HL7 version', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Add Mapping', exact: true }).click();
    await dialog.getByRole('button', { name: 'Target Field 1', exact: true }).click();
    const choices = dialog.getByRole('region', { name: 'Target Field 1 choices', exact: true });
    await choices.getByLabel('Search fields', { exact: true }).fill(required);
    await expect(choices).toContainText(required);
  });

test('MLLP destinations use host port TLS and ACK guidance with actionable invalid host errors', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await step(page, 2);
  await page.getByRole('combobox', { name: 'Connector', exact: true }).selectOption('MLLP');
  await expect(
    page.locator('.destination-editor').getByRole('textbox', { name: /Endpoint/ }),
  ).toHaveCount(0);
  await page.getByLabel('Host', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('Port', { exact: true }).fill('2575');
  await expect(page.getByText('ACK', { exact: false }).first()).toBeVisible();
  await page.getByLabel('Host', { exact: true }).fill('bad host');
  await step(page, 3);
  await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
  await page.getByLabel('Host', { exact: true }).fill('receiver.example.test');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = (
    captured(state, '/api/channel/1')[0].body.destinations as {
      endpoint: string;
      outboundDataType: string;
    }[]
  )[0];
  expect(saved.endpoint).toMatch(/^(?:tcp|mllp):\/\/receiver\.example\.test:2575/);
  expect(saved.outboundDataType).toBe('HL7V2');
});

test('REST delivery edits preserve saved security settings without authentication or header controls', async ({
  page,
}) => {
  const state = await workspace(page, {
    channels: [
      {
        ...existingChannel,
        destinations: [
          {
            ...existingChannel.destinations[0],
            deliveryPolicy: {
              http: {
                authentication: 'BEARER',
                headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }],
              },
            },
          },
        ],
      },
    ],
  });
  await openExisting(page);
  await step(page, 2);
  await page.getByText('Advanced destination settings', { exact: true }).click();
  await destinationSection(page, 'Delivery settings');
  await page.getByRole('combobox', { name: 'HTTP method', exact: true }).selectOption('PATCH');
  await page.getByRole('combobox', { name: 'Content-Type', exact: true }).selectOption('text/xml');
  await expect(page.getByRole('combobox', { name: 'Authentication', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Header', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Environment slot 1', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Saved destination security settings are retained.', { exact: true }),
  ).toBeVisible();
  await step(page, 3);
  await page.getByText('View details', { exact: true }).click();
  await expect(page.getByText('PATCH · text/xml', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(
    (captured(state, '/api/channel/1')[0].body.destinations as { deliveryPolicy: unknown }[])[0]
      .deliveryPolicy,
  ).toMatchObject({
    http: {
      method: 'PATCH',
      contentType: 'text/xml',
      authentication: 'BEARER',
      headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }],
    },
  });
});

test('review shows actual HL7 raw lines and a searchable metadata tree without unmasking values', async ({
  page,
}) => {
  await workspace(page);
  const raw =
    'MSH|^~\\&|SYNTHETIC|TEST|RECEIVER|TEST|20261018220000||ADT^A04|SYNTHETIC-001|T|2.5\rPID|1||SYNTHETIC-001||Patient^Example\r';
  await page.route('**/api/channel/preview-transformation', (route) =>
    route.fulfill({
      json: {
        success: true,
        accepted: true,
        elapsedMs: 4,
        networkDelivery: 'NOT_SENT',
        input: { format: 'JSON', payload: { patient_id: '[REDACTED]' } },
        source: {
          format: 'JSON',
          payload: {},
          validation: 'PASSED',
          filter: 'ACCEPTED',
          transformation: 'PASS_THROUGH',
        },
        results: [
          {
            name: 'PATIENT_XML_RECEIVER',
            outputFormat: 'HL7V2',
            status: 'VALID',
            routed: true,
            finalPayload: raw,
            fieldTree: [
              {
                path: 'PID',
                label: 'PID',
                type: 'object',
                selectable: true,
                children: [
                  {
                    path: 'PID.3',
                    label: 'PID.3 · Patient identifier',
                    type: 'string',
                    selectable: true,
                  },
                ],
              },
            ],
            stages: { filter: 'BYPASSED', transformation: 'TRANSFORMED', conversion: 'CONVERTED' },
            delivery: 'NOT_SENT',
          },
        ],
      },
    }),
  );
  await openExisting(page);
  await preview(page);
  const output = page.getByRole('region', { name: 'Generated output', exact: true });
  await expect(output.locator('pre')).toContainText('MSH|');
  await output.getByRole('button', { name: 'HL7 field tree', exact: true }).click();
  const tree = output.getByRole('region', { name: 'Generated HL7 fields', exact: true });
  await tree.getByLabel('Search fields', { exact: true }).fill('Patient identifier');
  await expect(tree).toContainText('PID.3');
  await expect(tree).not.toContainText('SYNTHETIC-001');
  await output.getByRole('button', { name: 'Raw HL7', exact: true }).click();
  await expect(output.locator('pre')).toContainText('PID|');
});

for (const format of ['XML', 'HL7V2', 'TEXT'] as const)
  test(`${format} keeps Source compact and supports format-specific input only in Review`, async ({
    page,
  }) => {
    const state = await workspace(page);
    await openExisting(page);
    await page.getByRole('combobox', { name: 'Inbound format', exact: true }).selectOption(format);
    await expect(page.getByText('Sample message (optional)', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Analyze fields', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /^Test input/ })).toHaveCount(0);
    await step(page, 3);
    await openReviewTest(page);
    const input = page.getByRole('textbox', { name: `Test input · ${format}`, exact: false });
    await expect(input).toBeVisible();
    await page.getByText('Input help', { exact: true }).click();
    await page.getByRole('button', { name: 'Load sample', exact: true }).click();
    const value = await input.inputValue();
    if (format === 'XML') expect(value).toContain('<Patient');
    else if (format === 'HL7V2') expect(value).toMatch(/^MSH\|/);
    else expect(value).toBe('Synthetic example message');
    await step(page, 0);
    await expect(page.getByText('Sample message (optional)', { exact: true })).toHaveCount(0);
    await step(page, 3);
    await openReviewTest(page);
    await expect(input).toHaveValue(value);
    expect(captured(state, '/api/channel/discover-fields')).toEqual([]);
    expect(state.externalRequests).toEqual([]);
  });

test('V2 mapping replacement with a script is explicit and cancellation keeps the configuration', async ({
  page,
}) => {
  const script = compileFieldMapping({
    version: 2,
    rows: [{ source: 'patient_id', target: 'PatientID', required: false, conversion: 'TEXT' }],
  });
  const state = await workspace(page, {
    channels: [{ ...existingChannel, processingScript: script }],
  });
  await openExisting(page);
  await step(page, 1);
  await page
    .getByRole('region', { name: 'Shared transformation', exact: true })
    .getByText('Advanced Custom Transformation Script', { exact: false })
    .click();
  const edit = page.getByRole('button', { name: 'Edit Script', exact: true });
  await edit.click();
  const confirm = page.getByRole('dialog', {
    name: 'Replace field mappings with a custom script?',
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Source Field 1', { exact: true })).toHaveValue('patient_id');
  await edit.click();
  await confirm.getByRole('button', { name: 'Replace with custom script', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Custom Transformation Script', exact: true });
  await expect(editor.locator('textarea')).toHaveValue('');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Target Field 1', { exact: true })).toHaveValue('PatientID');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel/1')[0].body.processingScript).toBe(script);
});

test('clean wizard defaults hide optional editors and keep one scroll area with visible navigation', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_CLEAN_WIZARD');
  const dialog = page.getByRole('dialog', { name: 'New channel', exact: true });
  await expect(dialog.getByText(/\/api\/message\/inbound\/\{channelId\}/)).toHaveCount(0);
  await expect(
    dialog.getByText('Source API key can be created after saving this channel.', { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('region', { name: 'Source field explorer', exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel('Source sample · JSON', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Sample message (optional)', { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('checkbox', { name: 'Enable source filter', exact: true }),
  ).not.toBeVisible();
  if (process.env.UI_CLEAN_SOURCE_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_CLEAN_SOURCE_SCREENSHOT });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'No transformation', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Add Mapping', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Script', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  if (process.env.UI_CLEAN_TRANSFORM_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_CLEAN_TRANSFORM_SCREENSHOT });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Destination name').fill('SYNTHETIC_RECEIVER');
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
  const advanced = page.locator('details[aria-label="Advanced destination settings"]');
  await expect(advanced).not.toHaveAttribute('open');
  await expect(advanced.locator(':scope > summary')).not.toContainText('Customized');
  await expect(page.getByRole('combobox', { name: 'HTTP method', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Header name 1', { exact: true })).toHaveCount(0);
  if (process.env.UI_CLEAN_DEST_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_CLEAN_DEST_SCREENSHOT });
  await advanced.locator(':scope > summary').click();
  const body = dialog.locator('.editor-body');
  await expect(body).toHaveCSS('overflow-y', 'auto');
  await expect(dialog.locator('.modal-body')).toHaveCSS('overflow-y', 'hidden');
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
  await expect(page.getByLabel('Channel setup steps')).toBeInViewport();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Integration flow')).toBeInViewport();
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(
    page.getByRole('region', { name: 'Source processing summary', exact: true }),
  ).toHaveCount(0);
  if (process.env.UI_CLEAN_REVIEW_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_CLEAN_REVIEW_SCREENSHOT });
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = captured(state, '/api/channel')[0].body;
  expect(saved.processingScript).toBe('');
  expect((saved.destinations as { deliveryPolicy?: unknown }[])[0].deliveryPolicy).toBeUndefined();
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  expect(state.externalRequests).toEqual([]);
});

test('switching common transformation to none requires confirmation and cancel preserves mapping', async ({
  page,
}) => {
  const state = await workspace(page);
  await openExisting(page);
  await step(page, 1);
  await addSharedMapping(page);
  await page.getByLabel('Source Field 1', { exact: true }).fill('patient_id');
  await page.getByLabel('Target Field 1', { exact: true }).fill('PatientID');
  await page.getByRole('radio', { name: 'No transformation', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Use pass-through?', exact: true });
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Target Field 1', { exact: true })).toHaveValue('PatientID');
  await page.getByRole('radio', { name: 'No transformation', exact: true }).click();
  await confirm.getByRole('button', { name: 'Use pass-through', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Mapping', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel/1')[0].body.processingScript).toBe('');
});

test('delivery errors reveal the exact field and retain saved security settings after save', async ({
  page,
}) => {
  const state = await workspace(page, {
    channels: [
      {
        ...existingChannel,
        destinations: [
          {
            ...existingChannel.destinations[0],
            deliveryPolicy: {
              http: {
                authentication: 'BEARER',
                headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }],
              },
            },
          },
        ],
      },
    ],
  });
  await openExisting(page);
  await step(page, 2);
  const advanced = page.locator('details[aria-label="Advanced destination settings"]');
  await advanced.locator(':scope > summary').click();
  await expect(advanced.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Header', exact: true })).toHaveCount(0);
  await destinationSection(page, 'Delivery settings');
  const timeout = page.getByLabel('Request timeout (seconds)', { exact: true });
  await timeout.fill('0');
  await advanced.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(advanced).toHaveAttribute('open', '');
  await expect(timeout).toBeFocused();
  await expect(timeout.locator('..').getByRole('alert')).toContainText('0.1 to 120');
  await timeout.fill('2.5');
  await advanced.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  const saved = (
    captured(state, '/api/channel/1')[0].body.destinations as {
      timeoutMs: number;
      deliveryPolicy: unknown;
    }[]
  )[0];
  expect(saved).toMatchObject({
    timeoutMs: 2500,
    deliveryPolicy: { http: { headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }] } },
  });
  await openExisting(page);
  await step(page, 2);
  await expect(advanced).not.toHaveAttribute('open');
  await expect(advanced.locator(':scope > summary')).toContainText('Customized');
  await advanced.locator(':scope > summary').click();
  await expect(page.getByLabel('Environment slot 1', { exact: true })).toHaveCount(0);
  // Saving an existing channel creates a draft; reopening active configuration retains its original timeout.
  await destinationSection(page, 'Delivery settings');
  await expect(timeout).toHaveValue('10');
  expect(state.externalRequests).toEqual([]);
});

test('changing output format keeps the Content-Type override and guides correction without header errors', async ({
  page,
}) => {
  const state = await workspace(page, {
    channels: [
      {
        ...existingChannel,
        destinations: [
          {
            ...existingChannel.destinations[0],
            deliveryPolicy: { http: { method: 'PATCH', contentType: 'text/xml' } },
          },
        ],
      },
    ],
  });
  await openExisting(page);
  await step(page, 2);
  await page.getByRole('combobox', { name: 'Outbound format', exact: true }).selectOption('JSON');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const content = page.getByRole('combobox', { name: 'Content-Type', exact: true });
  await expect(content).toHaveValue('text/xml');
  await expect(content).toBeFocused();
  await expect(content.locator('..').getByRole('alert')).toHaveText(
    'Select a supported Content-Type.',
  );
  await expect(page.getByLabel('Header name 1', { exact: true })).toHaveCount(0);
  await content.selectOption('');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(
    (captured(state, '/api/channel/1')[0].body.destinations as { deliveryPolicy: unknown }[])[0],
  ).toMatchObject({ deliveryPolicy: { http: { method: 'PATCH' } } });
});

test('compact destination shows connection fields only and retains HL7 mapping behind Advanced', async ({
  page,
}) => {
  const script = compileFieldMapping({
    version: 2,
    hl7: defaultHl7Configuration('ADT^A04'),
    rows: [{ source: 'patient_id', target: 'PID.3', required: true }],
  });
  const state = await workspace(page, {
    channels: [
      {
        ...existingChannel,
        destinations: [
          {
            ...existingChannel.destinations[0],
            outboundDataType: 'HL7V2',
            credentialConfigured: true,
            processingScript: script,
          },
        ],
      },
    ],
  });
  await openExisting(page);
  await step(page, 2);
  const dialog = page.getByRole('dialog', { name: 'Edit channel', exact: true });
  const destination = dialog.locator('.destination-editor');
  const advanced = destination.locator('details[aria-label="Advanced destination settings"]');
  await expect(
    destination.getByRole('heading', { name: 'Destination 1', exact: true }),
  ).toBeVisible();
  await expect(destination.getByLabel('Destination name', { exact: true })).toBeVisible();
  await expect(destination.getByLabel('Endpoint', { exact: false })).toBeVisible();
  await expect(destination.getByRole('combobox')).toHaveCount(2);
  await expect(
    destination.getByRole('combobox', { name: 'Outbound format', exact: true }),
  ).toHaveValue('HL7V2');
  await expect(advanced).not.toHaveAttribute('open');
  await expect(
    destination.getByText(
      'Saved endpoint credentials are retained only while this endpoint is unchanged.',
      { exact: true },
    ),
  ).not.toBeVisible();
  await expect(advanced.locator(':scope > summary')).toContainText('Customized');
  await expect(destination.getByRole('table')).toHaveCount(0);
  await expect(
    destination.getByRole('combobox', { name: 'Message type', exact: true }),
  ).toHaveCount(0);
  if (process.env.UI_COMPACT_DESTINATION_SCREENSHOT) {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await dialog.locator('.editor-body').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: process.env.UI_COMPACT_DESTINATION_SCREENSHOT });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 900 });
  await advanced.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(destination.getByRole('table')).toHaveCount(0);
  await destinationSection(page, 'Destination transformation settings');
  await expect(destination.getByLabel('Source Field 1', { exact: true })).toHaveValue('patient_id');
  await expect(destination.getByRole('table', { name: 'HL7 field mappings' })).toBeVisible();
  await expect(
    destination.getByRole('combobox', { name: 'Authentication', exact: true }),
  ).toHaveCount(0);
  await expect(destination.getByRole('button', { name: 'Add Header', exact: true })).toHaveCount(0);
  await advanced.locator(':scope > summary').click();
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(
    (captured(state, '/api/channel/1')[0].body.destinations as { processingScript: string }[])[0]
      .processingScript,
  ).toBe(script);
  expect(state.externalRequests).toEqual([]);
});

test('Source follows the agreed layout and Filter status reflects actual configuration', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New channel', exact: true });
  await expect(dialog.getByLabel('Channel name', { exact: false })).toBeVisible();
  await expect(
    dialog.getByRole('combobox', { name: 'Source connector', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Inbound format', exact: true })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Current source endpoint' })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Source authentication' })).toHaveCount(0);
  await expect(
    dialog.getByRole('heading', { name: 'Connect the sending system', exact: true }),
  ).toHaveCount(0);
  const advanced = dialog.locator('details[data-source-advanced]');
  await expect(advanced).not.toHaveAttribute('open');
  await advanced.locator(':scope > summary').click();
  await expect(advanced.locator(':scope > details > summary')).toHaveText([
    'Validation',
    'Filter · Off',
  ]);
  const filter = advanced.locator('details[aria-label="Source filter settings"]');
  await filter.locator(':scope > summary').click();
  const enabled = filter.getByRole('checkbox', { name: 'Enable source filter', exact: true });
  await enabled.check();
  await expect(filter.locator(':scope > summary')).toHaveText('Filter · Needs configuration');
  await expect(
    filter.getByText('Use a field from the incoming message.', { exact: false }),
  ).not.toBeVisible();
  await filter.getByLabel('Field', { exact: true }).fill('department');
  await filter.getByLabel('Value', { exact: true }).fill('LAB');
  await expect(filter.locator(':scope > summary')).toHaveText('Filter · Configured');
  await filter.getByLabel('Field', { exact: true }).fill('department.');
  await expect(filter.locator(':scope > summary')).toHaveText('Filter · Needs configuration');
  await enabled.uncheck();
  await expect(filter.locator(':scope > summary')).toHaveText('Filter · Off');
  await expect(dialog.getByLabel('Channel name', { exact: false })).toBeVisible();
  expect(captured(state, '/api/channel')).toEqual([]);
  expect(state.rotations).toBe(0);
  expect(state.externalRequests).toEqual([]);
});

test('Transformation uses compact mapping rows with one header and optional settings', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  await step(page, 1);
  const shared = page.getByRole('region', { name: 'Shared transformation', exact: true });
  await addSharedMapping(page);
  await shared.getByLabel('Source Field 1', { exact: true }).fill('patient_id');
  await shared.getByLabel('Target Field 1', { exact: true }).fill('PatientID');
  await shared.getByRole('button', { name: 'Add Mapping', exact: true }).click();
  await shared.getByLabel('Source Field 2', { exact: true }).fill('name');
  await shared.getByLabel('Target Field 2', { exact: true }).fill('PatientName');
  await expect(shared.locator('.mapping-grid-head')).toHaveCount(1);
  await expect(shared.locator('.mapping-grid-head')).toHaveText('Source FieldTarget Field');
  await expect(shared.getByLabel('Required field 1', { exact: true })).not.toBeVisible();
  await expect(shared.getByLabel('Default value 1', { exact: true })).not.toBeVisible();
  await expect(shared.getByLabel('Type conversion 1', { exact: true })).not.toBeVisible();
  await expect(shared).toContainText('Unmapped fields are excluded.');
  for (const row of await shared.locator('.mapping-row').all()) {
    const box = await row.boundingBox();
    expect(box!.height).toBeLessThan(120);
  }
  const addBox = await shared
    .getByRole('button', { name: 'Add Mapping', exact: true })
    .boundingBox();
  expect(addBox!.width).toBeLessThan(250);
  if (process.env.UI_COMPACT_TRANSFORMATION_SCREENSHOT) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: process.env.UI_COMPACT_TRANSFORMATION_SCREENSHOT });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(shared.getByLabel('Target Field 2', { exact: true })).toBeVisible();
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  const options = shared.locator('details[aria-label="Mapping options 1"]');
  await options.locator(':scope > summary').click();
  await shared.getByLabel('Required field 1', { exact: true }).check();
  await shared.getByLabel('Default value 1', { exact: true }).fill('SYNTHETIC-DEFAULT');
  await options.locator(':scope > summary').click();
  await expect(options.locator(':scope > summary')).toContainText('Configured');
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Channel saved', exact: true })).toBeVisible();
  expect(
    readFieldMapping(captured(state, '/api/channel')[0].body.processingScript as string)?.rows,
  ).toEqual([
    {
      source: 'patient_id',
      target: 'PatientID',
      required: true,
      defaultValue: 'SYNTHETIC-DEFAULT',
    },
    { source: 'name', target: 'PatientName', required: false },
  ]);
  expect(state.externalRequests).toEqual([]);
});

test('Use template fills the destination editor and confirms before replacing custom code', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  await destinationSection(page, 'Advanced destination settings');
  const transformation = await destinationSection(page, 'Destination transformation settings');
  await transformation.getByText('Advanced Custom Transformation Script', { exact: false }).click();
  const edit = transformation.getByRole('button', { name: 'Edit Script', exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', {
    name: 'Destination Transformation Script',
    exact: true,
  });
  const code = dialog.getByRole('textbox', {
    name: 'Destination Transformation Script',
    exact: true,
  });
  const template = '// Transform msg and return the result.\nreturn msg;';
  const custom = 'return { patientId: msg.patient_id };';
  await expect(code).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Use template', exact: true })).not.toBeVisible();
  await dialog.getByText('Script help', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(code).toHaveValue(template);
  const confirmation = page.getByRole('dialog', {
    name: 'Replace script with template?',
    exact: true,
  });
  await expect(confirmation).toHaveCount(0);
  await code.fill(custom);
  await dialog.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await expect(code).toHaveValue(custom);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(code).toHaveValue(custom);
  await expect(dialog.getByRole('button', { name: 'Use template', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Use template', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(code).toHaveValue(template);
  await expect(confirmation).toHaveCount(0);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Save Script', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Channel setup steps').getByRole('button').nth(2)).toHaveAttribute(
    'aria-current',
    'step',
  );
  expect(captured(state, '/api/channel')).toEqual([]);
  expect(captured(state, '/api/channel/dry-run')).toEqual([]);
  expect(captured(state, '/api/channel/preview-transformation')).toEqual([]);
  await edit.click();
  await expect(code).toHaveValue(template);
  await code.fill(custom);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await edit.click();
  await expect(code).toHaveValue(template);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Channel saved', exact: true })).toBeVisible();
  const saved = captured(state, '/api/channel')[0].body;
  expect((saved.destinations as { processingScript: string }[])[0].processingScript).toBe(template);
  expect(saved.processingScript).toBe('');
  expect(state.externalRequests).toEqual([]);
});

test('Use template supplies the destination filter boolean example without applying it on Cancel', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await newJsonXmlChannel(page);
  const destination = await destinationAdvanced(page);
  await destination
    .getByRole('checkbox', { name: 'Enable destination filter', exact: true })
    .check();
  await destination.getByText('Advanced custom condition', { exact: true }).click();
  await destination.getByRole('button', { name: 'Edit custom condition', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Destination custom condition', exact: true });
  const code = dialog.getByRole('textbox', { name: 'Destination custom condition', exact: true });
  await dialog.getByText('Script help', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(code).toHaveValue(/return msg.department === "LAB";/);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await destination.getByRole('button', { name: 'Edit custom condition', exact: true }).click();
  await expect(code).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(captured(state, '/api/channel')).toEqual([]);
  expect(captured(state, '/api/channel/dry-run')).toEqual([]);
  expect(state.externalRequests).toEqual([]);
});

test('script dialog has a full width editor and normal footer buttons without submitting the wizard', async ({
  page,
}) => {
  const original = 'return { patientId: msg.patient_id };';
  const replacement = 'return { id: msg.patient_id };';
  const state = await workspace(page, {
    channels: [{ ...existingChannel, processingScript: original }],
  });
  await openExisting(page);
  await step(page, 1);
  const shared = page.getByRole('region', { name: 'Shared transformation', exact: true });
  await shared.getByText('Advanced Custom Transformation Script', { exact: false }).click();
  const edit = shared.getByRole('button', { name: 'Edit Script', exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Custom Transformation Script', exact: true });
  const code = dialog.getByRole('textbox', { name: 'Custom Transformation Script', exact: true });
  await expect(code).toHaveValue(original);
  await expect(dialog.getByText('Script help', { exact: true }).locator('..')).not.toHaveAttribute(
    'open',
  );
  const scriptBox = await code.boundingBox();
  expect(scriptBox!.width).toBeGreaterThan(500);
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const save = dialog.getByRole('button', { name: 'Save Script', exact: true });
  const cancelBox = await cancel.boundingBox();
  const saveBox = await save.boundingBox();
  expect(cancelBox!.height).toBeLessThan(56);
  expect(saveBox!.height).toBeLessThan(56);
  expect(saveBox!.width).toBeLessThan(200);
  expect(saveBox!.y).toBeGreaterThanOrEqual(scriptBox!.y + scriptBox!.height);
  expect(saveBox!.y).toBe(cancelBox!.y);
  if (process.env.UI_SCRIPT_EDITOR_SCREENSHOT)
    await page.screenshot({ path: process.env.UI_SCRIPT_EDITOR_SCREENSHOT });
  await page.setViewportSize({ width: 390, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(cancel).toBeInViewport();
  await expect(save).toBeInViewport();
  await save.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await code.fill(replacement);
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Channel setup steps').getByRole('button').nth(1)).toHaveAttribute(
    'aria-current',
    'step',
  );
  expect(captured(state, '/api/channel/1')).toEqual([]);
  await edit.click();
  await expect(code).toHaveValue(replacement);
  await code.fill('return { discarded: true };');
  await cancel.click();
  await expect(edit).toBeFocused();
  await edit.click();
  await expect(code).toHaveValue(replacement);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Edit channel', exact: true })).toBeVisible();
  await step(page, 3);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit channel', exact: true })).toHaveCount(0);
  expect(captured(state, '/api/channel/1')[0].body.processingScript).toBe(replacement);
  expect(state.externalRequests).toEqual([]);
});

for (const [legacyType, displayedType, format, enabled] of [
  ['HL7', 'MLLP', 'HL7V2', true],
  ['RAW', 'TCP', 'TEXT', false],
] as const)
  test(`destination connector ${legacyType} shows one canonical choice and preserves saved configuration`, async ({
    page,
  }) => {
    const state = await workspace(page, {
      channels: [
        {
          ...existingChannel,
          source: { ...existingChannel.source, inboundDataType: format },
          destinations: [
            {
              ...existingChannel.destinations[0],
              type: legacyType,
              outboundDataType: format,
              endpoint: 'tcp://receiver.example.test:2575',
              isEnabled: enabled,
            },
          ],
        },
      ],
    });
    await openExisting(page);
    await step(page, 2);
    const destination = page.locator('.destination-editor').first();
    const connector = destination.getByRole('combobox', { name: 'Connector', exact: true });
    await expect(connector).toHaveValue(displayedType);
    await expect(connector.locator('option')).toHaveText([
      'HTTP sender',
      'MLLP sender',
      'TCP sender',
    ]);
    await expect(
      destination.getByRole('checkbox', { name: 'Destination enabled', exact: true }),
    ).toBeChecked({ checked: enabled });
    await expect(destination.getByLabel('Host', { exact: true })).toHaveValue(
      'receiver.example.test',
    );
    await step(page, 3);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit channel', exact: true })).toHaveCount(0);
    expect(
      (captured(state, '/api/channel/1')[0].body.destinations as Record<string, unknown>[])[0],
    ).toMatchObject({
      type: legacyType,
      outboundDataType: format,
      endpoint: 'tcp://receiver.example.test:2575',
      isEnabled: enabled,
    });
    expect(state.externalRequests).toEqual([]);
  });

for (const resetOverrides of [false, true])
  test(`destination sections stay closed and HL7 overrides are ${resetOverrides ? 'explicitly reset' : 'preserved'}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const hl7 = {
      ...defaultHl7Configuration('ADT^A01'),
      messageDateTime: '20261018220000',
      messageControlId: 'SYNTHETIC-FIXED-ID',
    };
    const script = compileFieldMapping({
      version: 2,
      hl7,
      rows: [
        { source: 'patient_id', target: 'PID.3', required: true },
        { source: 'name', target: 'PID.5', required: true },
      ],
    });
    const state = await workspace(page, {
      channels: [
        {
          ...existingChannel,
          destinations: [
            {
              ...existingChannel.destinations[0],
              outboundDataType: 'HL7V2',
              processingScript: script,
            },
          ],
        },
      ],
    });
    await openExisting(page);
    await step(page, 2);
    const destination = page.locator('.destination-editor').first();
    const advanced = await destinationSection(page, 'Advanced destination settings');
    const groups = advanced.locator(':scope > details');
    await expect(groups).toHaveCount(4);
    await expect(groups.locator(':scope > summary')).toHaveText([
      'Transformation · Configured',
      'Filter · Off',
      'Delivery',
      'HL7 settings',
    ]);
    for (const section of await groups.all()) await expect(section).not.toHaveAttribute('open');
    if (!resetOverrides && process.env.UI_DESTINATION_GROUPS_SCREENSHOT) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: process.env.UI_DESTINATION_GROUPS_SCREENSHOT });
    }
    await destinationSection(page, 'Destination transformation settings');
    await expect(destination.locator('output[aria-label="HL7 version"]')).toHaveText('2.5');
    await expect(
      destination.getByRole('combobox', { name: 'HL7 version', exact: true }),
    ).toHaveCount(0);
    await expect(destination.getByRole('columnheader')).toHaveText([
      'JSON field',
      'HL7 field',
      'Actions',
    ]);
    await expect(
      destination.getByRole('button', { name: 'Target Field 1', exact: true }),
    ).toContainText('Patient identifier');
    const options = destination.locator('details[aria-label="Mapping options 1"]');
    await options.locator(':scope > summary').click();
    const sourceBox = await destination.getByLabel('Source Field 1', { exact: true }).boundingBox();
    const optionsBox = await options.boundingBox();
    expect(optionsBox!.width).toBeGreaterThan(sourceBox!.width * 1.7);
    if (!resetOverrides && process.env.UI_DESTINATION_HL7_SCREENSHOT)
      await page.screenshot({ path: process.env.UI_DESTINATION_HL7_SCREENSHOT });
    await options.locator(':scope > summary').click();
    await destination.getByLabel('Source Field 1', { exact: true }).fill('patient_record_id');
    const settings = await destinationSection(page, 'HL7 destination settings');
    await expect(settings.getByRole('status')).toHaveText(
      'Saved timestamp/control ID overrides are retained.',
    );
    await expect(
      settings.getByRole('textbox', { name: /^Message date\/time|^Message control ID/ }),
    ).toHaveCount(0);
    await expect(settings).not.toContainText('SYNTHETIC-FIXED-ID');
    if (resetOverrides) {
      await settings
        .getByRole('button', { name: 'Use generated time and ID', exact: true })
        .click();
      await expect(settings.getByRole('status')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await step(page, 3);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit channel', exact: true })).toHaveCount(0);
    const saved = readFieldMapping(
      (captured(state, '/api/channel/1')[0].body.destinations as { processingScript: string }[])[0]
        .processingScript,
    );
    expect(saved).toMatchObject({
      version: 2,
      hl7: resetOverrides
        ? Object.fromEntries(
            Object.entries(hl7).filter(
              ([key]) => !['messageDateTime', 'messageControlId'].includes(key),
            ),
          )
        : hl7,
      rows: [
        { source: 'patient_record_id', target: 'PID.3', required: true },
        { source: 'name', target: 'PID.5', required: true },
      ],
    });
    if (resetOverrides && saved?.version === 2) {
      expect(saved.hl7).not.toHaveProperty('messageDateTime');
      expect(saved.hl7).not.toHaveProperty('messageControlId');
    }
    expect(state.externalRequests).toEqual([]);
  });
