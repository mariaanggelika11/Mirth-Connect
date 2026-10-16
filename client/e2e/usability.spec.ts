import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// All API and destination requests are intercepted. These fixtures contain only synthetic data.
const productionBase = 'https://connect.bulmar.tech';
const receiver = 'https://receiver.example.test/messages';
const fixtureKey = (rotation: number) => `SYNTHETIC_SOURCE_KEY_ROTATION_${rotation}`;
const inbound = { patient: '[REDACTED]' };
const rawInbound = { patient: { name: 'SYNTHETIC EXAMPLE', identifier: 'SYNTHETIC-001' } };
const xml = '[REDACTED TEXT]';
const rawXml =
  '<patient>\n  <name>SYNTHETIC EXAMPLE</name>\n  <identifier>SYNTHETIC-001</identifier>\n</patient>';
const timestamp = '2026-10-16T02:00:00Z';
const existingChannel = {
  id: 1,
  name: 'Synthetic integration',
  status: 'STOPPED',
  activeRevision: 1,
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
    if (path === '/api/channel' && method === 'GET') return route.fulfill({ json: state.channels });
    if (path === '/api/channel' && method === 'POST') {
      const channel = {
        ...body,
        id: 2,
        status: 'STOPPED',
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
    if (path === '/api/channel/dry-run') {
      const payload = body.raw ? rawInbound : inbound;
      return route.fulfill({
        json: {
          success: true,
          accepted: true,
          elapsedMs: 5,
          networkDelivery: 'NOT_SENT',
          input: { format: 'JSON', payload },
          source: {
            format: 'JSON',
            payload,
            validation: 'PASSED',
            filter: 'ACCEPTED',
            transformation: 'PASS_THROUGH',
          },
          results: [
            {
              name: 'PATIENT_XML_RECEIVER',
              outputFormat: 'XML',
              connectorType: 'REST',
              status: 'VALID',
              routed: true,
              finalPayload: body.raw ? rawXml : xml,
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
async function newJsonXmlChannel(page: Page) {
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_JSON_TO_XML');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Destination name').fill('PATIENT_XML_RECEIVER');
  await page.getByLabel('Outbound format', { exact: false }).selectOption('XML');
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
}

test('simple JSON to XML setup previews output, saves without a summary, and guides a confirmed test', async ({
  page,
}) => {
  const state = await workspace(page, { channels: [] });
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  await expect(page.getByLabel('Inbound format', { exact: false })).toHaveValue('JSON');
  await expect(page.getByLabel('Duplicate message protection', { exact: false })).not.toBeVisible();
  await expect(page.getByLabel('Custom validation profile (JSON)', { exact: false })).toHaveCount(
    0,
  );
  await page.getByText('Advanced source settings', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'No additional validation' })).toBeChecked();
  await expect(page.getByLabel('Duplicate message protection', { exact: false })).toHaveValue(
    'OPTIONAL',
  );
  await page.getByText('Advanced source settings', { exact: true }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('SYNTHETIC_JSON_TO_XML');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('No source transformation · Pass-through')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Enable source filter' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Destination name').fill('PATIENT_XML_RECEIVER');
  await page.getByLabel('Outbound format', { exact: false }).selectOption('XML');
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText('Endpoint reachable', { exact: true })).toBeVisible();
  await expect(page.getByText('TLS handshake', { exact: false })).toBeVisible();
  expect(captured(state, '/api/channel/test-connection')[0].body).toEqual({
    endpoint: receiver,
    type: 'REST',
    timeoutMs: 10000,
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Change summary', { exact: false })).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Input message (synthetic only)', exact: true })
    .fill(JSON.stringify(rawInbound));
  await page.getByRole('button', { name: 'Preview output', exact: true }).click();
  await expect(page.getByText('Network delivery: NOT_SENT', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preview destination processing' })).toContainText(
    xml,
  );
  expect(captured(state, '/api/channel/dry-run')[0].body).toMatchObject({
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
  await page.getByRole('checkbox', { name: 'View raw synthetic preview (audited)' }).check();
  await page.getByRole('button', { name: 'Preview output', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Preview destination processing' })).toContainText(
    rawXml,
  );
  expect(captured(state, '/api/channel/dry-run').at(-1)?.body.raw).toBe(true);
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Channel saved', exact: true })).toBeVisible();
  expect(
    captured(state, '/api/channel').find((request) => request.method === 'POST')?.body,
  ).toMatchObject({
    changeSummary: 'Initial channel configuration',
  });
  const onboarding = page.getByRole('dialog', { name: 'Channel saved', exact: true });
  const endpoint = onboarding.getByRole('region', { name: 'Current source endpoint' });
  await expect(endpoint).toContainText(`${productionBase}/api/message/inbound/2`);
  await endpoint.getByRole('button', { name: 'Copy endpoint', exact: true }).click();
  expect(await clipboard(page)).toBe(`${productionBase}/api/message/inbound/2`);
  await endpoint.getByRole('button', { name: 'Copy curl example' }).click();
  expect(await clipboard(page)).toContain(`${productionBase}/api/message/inbound/2`);
  expect(await clipboard(page)).toContain('X-API-Key: <SOURCE_API_KEY>');
  await endpoint.getByRole('button', { name: 'Copy Postman request' }).click();
  const postman = JSON.parse(await clipboard(page));
  expect(postman.item[0].request.url).toBe(`${productionBase}/api/message/inbound/2`);
  expect(postman.item[0].request.header).toContainEqual({
    key: 'X-API-Key',
    value: '{{source_api_key}}',
  });
  await onboarding.getByRole('button', { name: 'Create API key', exact: true }).click();
  await expect(
    page.getByText('A new key immediately invalidates the previous key.', { exact: false }),
  ).toBeVisible();
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
  await expect(
    page.getByText('It performs real network delivery.', { exact: false }),
  ).toBeVisible();
  expect(captured(state, '/api/message/inbound/2')).toHaveLength(0);
  await page.getByRole('button', { name: 'Send test request', exact: true }).click();
  await expect(onboarding.getByText('Test message received · #1.', { exact: false })).toBeVisible();
  const delivery = captured(state, '/api/message/inbound/2')[0];
  expect(delivery.body).toEqual({ message: 'Synthetic connection test' });
  expect(delivery.headers['x-api-key']).toBe(fixtureKey(2));
  expect(delivery.headers['idempotency-key']).toMatch(/^[\da-f-]{36}$/i);
  await onboarding.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText(fixtureKey(2), { exact: true })).toHaveCount(0);
  await page.getByLabel('More actions for SYNTHETIC_JSON_TO_XML').click();
  await page.getByRole('button', { name: 'Edit channel', exact: true }).click();
  await expect(page.getByText(fixtureKey(2), { exact: true })).toHaveCount(0);
  expect(await clipboard(page)).not.toContain(fixtureKey(2));
});

test('advanced filtering and retry stay optional and disabled filter scripts are not submitted', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('Synthetic advanced choices');
  await page.getByText('Advanced source settings', { exact: true }).click();
  await page.getByRole('radio', { name: 'Basic JSON validation' }).check();
  await expect(page.getByLabel('Custom validation profile (JSON)', { exact: false })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Advanced processing', { exact: true }).click();
  await expect(page.getByText('All messages are accepted.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Enable source filter' }).check();
  await page.getByLabel('Source filter script', { exact: false }).fill('return false;');
  await page.getByRole('checkbox', { name: 'Enable source filter' }).uncheck();
  await expect(page.getByLabel('Source filter script', { exact: false })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Enable source filter' }).check();
  await expect(page.getByLabel('Source filter script', { exact: false })).toHaveValue(
    'return false;',
  );
  await page.getByRole('checkbox', { name: 'Enable source filter' }).uncheck();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Destination name').fill('PATIENT_XML_RECEIVER');
  await page.getByLabel('Outbound format', { exact: false }).selectOption('XML');
  await page.getByLabel('Endpoint', { exact: false }).fill(receiver);
  await expect(page.getByRole('checkbox', { name: 'Automatic retry' })).not.toBeVisible();
  await page.getByText('Advanced destination settings', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Automatic retry' })).not.toBeChecked();
  await expect(page.getByLabel('Retry attempts', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Automatic retry' }).check();
  await page.getByLabel('Retry attempts', { exact: true }).fill('4');
  await page.getByLabel('Retry interval (seconds)', { exact: true }).fill('15');
  await page.getByLabel('Request timeout (seconds)', { exact: true }).fill('2.5');
  await page.getByRole('checkbox', { name: 'Automatic retry' }).uncheck();
  await expect(page.getByLabel('Retry attempts', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Automatic retry' }).check();
  await expect(page.getByLabel('Retry attempts', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Input message (synthetic only)', exact: true })
    .fill(JSON.stringify(rawInbound));
  await page.getByRole('button', { name: 'Preview output', exact: true }).click();
  await expect(page.getByText('Network delivery: NOT_SENT', { exact: true })).toBeVisible();
  expect(captured(state, '/api/channel/dry-run')[0].body).toMatchObject({
    configuration: {
      validationProfile: { jsonSchema: { type: 'object' } },
      filterScript: '',
      processingScript: '',
      destinations: [
        { retryEnabled: true, maxRetries: 4, retryIntervalSeconds: 15, timeoutMs: 2500 },
      ],
    },
  });
  expect(state.externalRequests).toEqual([]);
});

test('editing preserves advanced legacy configuration and requires a change summary', async ({
  page,
}) => {
  const legacy = {
    ...existingChannel,
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
      },
    ],
  };
  const state = await workspace(page, { channels: [legacy] });
  await page.getByLabel(`More actions for ${legacy.name}`).click();
  await page.getByRole('button', { name: 'Edit channel', exact: true }).click();
  await page.getByText('Advanced source settings', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Custom validation schema' })).toBeChecked();
  await expect(page.getByLabel('Custom validation profile (JSON)', { exact: false })).toContainText(
    'patient',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Custom transformation enabled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const summary = page.getByLabel('Change summary', { exact: false });
  await expect(summary).toHaveAttribute('required', '');
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  expect(captured(state, '/api/channel/1')).toHaveLength(0);
  await summary.fill('Synthetic review; retain existing processing');
  await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(captured(state, '/api/channel/1')[0].body).toMatchObject({
    validationProfile: legacy.validationProfile,
    processingScript: legacy.processingScript,
    filterScript: legacy.filterScript,
    responseScript: legacy.responseScript,
    destinations: legacy.destinations,
    changeSummary: 'Synthetic review; retain existing processing',
  });
});

for (const [label, base] of [
  ['local', 'http://localhost:9000'],
  ['production', productionBase],
] as const)
  test(`${label} source endpoint uses the server URL and placeholder request examples`, async ({
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
    await page.getByLabel(`More actions for ${existingChannel.name}`).click();
    await page.getByRole('button', { name: 'Edit channel', exact: true }).click();
    const endpoint = page.getByRole('region', { name: 'Current source endpoint' });
    await expect(endpoint).toContainText(`${base}/api/message/inbound/1`);
    await endpoint.getByRole('button', { name: 'Copy curl example' }).click();
    expect(await clipboard(page)).toContain(`POST '${base}/api/message/inbound/1'`);
    expect(await clipboard(page)).toContain('<SOURCE_API_KEY>');
    await endpoint.getByRole('button', { name: 'Copy Postman request' }).click();
    expect(JSON.parse(await clipboard(page)).item[0].request.url).toBe(
      `${base}/api/message/inbound/1`,
    );
  });

test('Messages separates inbound, source and final output while auditing raw pagination', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  await page.getByRole('tab', { name: 'Payload', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Original inbound payload', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Source processed payload', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('No source transformation', { exact: true })).toBeVisible();
  const delivery = page.getByRole('region', { name: 'Outbound delivery to PATIENT_XML_RECEIVER' });
  await expect(delivery).toContainText(xml);
  await expect(delivery).toContainText('XML');
  await expect(delivery).toContainText('OUT-SENT');
  await expect(delivery).toContainText('Synthetic destination accepted');
  await expect(page.getByText('SYNTHETIC EXAMPLE', { exact: false })).toHaveCount(0);
  await delivery.getByRole('button', { name: 'Copy Outbound payload', exact: true }).click();
  expect(await clipboard(page)).toBe(xml);
  await expect(
    page.getByText('Viewing raw payload will be recorded in the audit log.', { exact: true }),
  ).toBeVisible();
  expect(state.details.filter((request) => request.raw)).toHaveLength(0);
  await page.getByRole('button', { name: 'Next results', exact: true }).click();
  await expect(page.getByText('Results page 2', { exact: true })).toBeVisible();
  await expect(delivery).toContainText('REMOTE_HTTP_ERROR');
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
    page.getByRole('heading', { name: 'Stored outbound payload', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Original inbound payload', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Source processed payload', exact: true }),
  ).toHaveCount(0);
});

test('raw preview and raw Messages controls follow the current role', async ({ page }) => {
  const state = await workspace(page, { role: 'DEVELOPER' });
  await newJsonXmlChannel(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Input message (synthetic only)', exact: true })
    .fill(JSON.stringify(rawInbound));
  await expect(
    page.getByRole('checkbox', { name: 'View raw synthetic preview (audited)' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview output', exact: true }).click();
  await expect(page.getByText('Network delivery: NOT_SENT', { exact: true })).toBeVisible();
  expect(captured(state, '/api/channel/dry-run')[0].body.raw).toBe(false);
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

test('administrator raw synthetic preview is explicit and never sends a delivery', async ({
  page,
}) => {
  const state = await workspace(page);
  await newJsonXmlChannel(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Input message (synthetic only)', exact: true })
    .fill(JSON.stringify(rawInbound));
  await page.getByRole('checkbox', { name: 'View raw synthetic preview (audited)' }).check();
  await page.getByRole('button', { name: 'Preview output', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Preview destination processing' })).toContainText(
    rawXml,
  );
  expect(captured(state, '/api/channel/dry-run')[0].body.raw).toBe(true);
  expect(
    state.requests.filter((request) => request.path.startsWith('/api/message/inbound/')),
  ).toHaveLength(0);
  expect(state.externalRequests).toEqual([]);
});

test('simplified channel setup supports mobile keyboard navigation and WCAG checks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page);
  await page.getByRole('button', { name: 'New Channel', exact: true }).click();
  const advanced = page.getByText('Advanced source settings', { exact: true });
  await advanced.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Duplicate message protection', { exact: false })).toBeVisible();
  await page.getByRole('radio', { name: 'Custom validation schema' }).check();
  await expect(page.getByLabel('Custom validation profile (JSON)', { exact: false })).toBeVisible();
  const scan = await new AxeBuilder({ page })
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
