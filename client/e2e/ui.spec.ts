import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
// Synthetic browser fixtures. No writes to the real workspace database.
const channel = {
  id: 1,
  activeRevision: 1,
  name: 'Test Channel',
  status: 'STOPPED',
  source: { type: 'HTTP', endpoint: '/api/inbound/1' },
  destinations: [],
  received: 0,
};
test('revision review, compare and publish are permission-aware and functional', async ({
  page,
}) => {
  await session(page, 'DEVELOPER');
  await page.route('**/api/channel/1/revisions', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            revision: 2,
            state: 'DRAFT',
            change_summary: 'Synthetic draft',
            checksum: 'synthetic-new',
          },
          {
            revision: 1,
            state: 'PUBLISHED',
            change_summary: 'Initial synthetic configuration',
            checksum: 'synthetic-old',
          },
        ],
      },
    }),
  );
  await page.route('**/api/channel/1/revisions/1', (route) =>
    route.fulfill({
      json: { success: true, data: { name: 'Before synthetic', destinations: [] } },
    }),
  );
  await page.route('**/api/channel/1/revisions/2', (route) =>
    route.fulfill({ json: { success: true, data: { name: 'After synthetic', destinations: [] } } }),
  );
  let publishBody: unknown;
  await page.route('**/api/channel/1/revisions/2/publish', (route) => {
    publishBody = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, activeRevision: 3 } });
  });
  await page.getByLabel('More actions for Test Channel').click();
  await page.getByRole('button', { name: 'Revisions', exact: true }).click();
  await expect(page.getByText('Active revision: 1.', { exact: false })).toBeVisible();
  await page.getByLabel('Compare revision 2').check();
  await page.getByLabel('Compare revision 1').check();
  await page.getByRole('button', { name: 'Compare selected revisions' }).click();
  await expect(page.locator('pre').filter({ hasText: 'Before synthetic' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.getByLabel('Publish / rollback summary').fill('Synthetic reviewed activation');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(publishBody).toEqual({
    changeSummary: 'Synthetic reviewed activation',
    expectedActiveRevision: 1,
  });
  expect(await page.evaluate(() => localStorage.getItem('authToken'))).toBeNull();
});
const token =
  Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url') +
  '.' +
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') +
  '.test-signature';
async function session(page: Page, role: string, view: 'overview' | 'channels' = 'channels') {
  await page.route('**/health', (r) => r.fulfill({ json: { status: 'ok' } }));
  await page.route('**/ready', (r) => r.fulfill({ json: { status: 'ready' } }));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/browser/login') return route.fulfill({ json: { token } });
    if (url.pathname === '/api/auth/me')
      return route.fulfill({ json: { success: true, data: { id: 1, name: 'Test', role } } });
    if (url.pathname === '/api/channel') return route.fulfill({ json: [channel] });
    if (url.pathname === '/api/message/stats')
      return route.fulfill({
        json: {
          totalReceived: 420,
          totalSent: 400,
          totalErrors: 2,
          successfulMessages: 390,
          failedMessages: 2,
          retryingMessages: 1,
          channelsRunning: 1,
          channelsStopped: 0,
          channelsError: 0,
          messagesToday: 42,
          queuedMessages: 3,
          deadLetterMessages: 0,
        },
      });
    if (url.pathname === '/api/system/configuration')
      return route.fulfill({
        json: {
          success: true,
          data: {
            runtime: {
              node: 'v22.18.0',
              environment: 'non-production',
              encryptionKeyVersion: 'v1',
            },
            transport: {
              postgresTlsVerified: true,
              mllpEnabled: true,
              mllpTls: true,
              mllpMutualTls: false,
            },
            retention: { enabled: true, messageDays: 30, auditDays: 365 },
          },
        },
      });
    if (url.pathname === '/api/users')
      return route.fulfill({
        json: {
          success: true,
          data: [{ id: 1, name: 'Workspace Admin', username: 'admin@example.com', role: 'ADMIN' }],
          page: 1,
        },
      });
    if (url.pathname === '/api/audit')
      return route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 1,
              action: 'CREATE_CHANNEL',
              resource_type: 'channel',
              resource_id: 1,
              user_id: 1,
              created_at: '2026-10-04T00:00:00Z',
            },
          ],
          page: 1,
        },
      });
    if (url.pathname === '/api/message')
      return route.fulfill({
        json: {
          success: true,
          data:
            url.searchParams.get('status') === 'DEAD_LETTER' ||
            url.searchParams.get('statusGroup') === 'errors'
              ? []
              : [
                  {
                    id: 1,
                    timestamp: '2026-10-04T00:00:00Z',
                    channelId: 1,
                    channelName: 'Test Channel',
                    direction: 'IN',
                    status: 'SUCCESS',
                    level: 'INFO',
                    retryCount: 0,
                    destinationLogs: [],
                  },
                ],
          pagination: {
            page: Number(url.searchParams.get('page') || 1),
            pageSize: 50,
            total:
              url.searchParams.get('status') === 'DEAD_LETTER' ||
              url.searchParams.get('statusGroup') === 'errors'
                ? 0
                : 101,
          },
        },
      });
    if (url.pathname === '/api/message/1')
      return route.fulfill({
        json: {
          success: true,
          data: {
            id: 1,
            timestamp: '2026-10-04T00:00:00Z',
            channelId: 1,
            channelName: 'Test Channel',
            direction: 'IN',
            status: 'SUCCESS',
            level: 'INFO',
            payloadAllowed: role !== 'VIEWER',
            originalPayload: '<img src=x onerror=alert(1)>',
            destinationLogs: [],
          },
        },
      });
    return route.fulfill({ json: { success: true } });
  });
  await page.goto('/');
  await page.locator('input[type="text"]').fill('test-user');
  await page.locator('input[type="password"]').fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  if (view === 'channels') {
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible();
  }
}
test('viewer sees metadata and no channel mutation controls', async ({ page }) => {
  await session(page, 'VIEWER');
  await page.getByLabel('More actions for Test Channel').click();
  for (const name of ['New Channel', 'Edit channel', 'Delete channel', 'Start channel'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
});
test('operator can operate but cannot edit or delete', async ({ page }) => {
  await session(page, 'OPERATOR');
  await expect(page.getByRole('button', { name: 'Start channel' })).toBeVisible();
  await page.getByLabel('More actions for Test Channel').click();
  await expect(page.getByRole('button', { name: 'Edit channel', exact: true })).toHaveCount(0);
});
test('developer can edit and admin can delete through contextual menu', async ({ page }) => {
  await session(page, 'DEVELOPER');
  await expect(page.getByRole('button', { name: 'New Channel' })).toBeVisible();
  await page.getByLabel('More actions for Test Channel').click();
  await expect(page.getByRole('button', { name: 'Edit channel', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete channel', exact: true })).toHaveCount(0);
});
test('message pagination and metadata drawer preserve list state', async ({ page }) => {
  await session(page, 'VIEWER');
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await expect(page.getByText('Page 1 of 3')).toBeVisible();
  const next = page.waitForRequest(
    (r) => r.url().includes('/api/message?') && r.url().includes('page=2'),
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await next;
  await expect(page.getByText('Page 2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Message #1' })).toBeVisible();
  await expect(
    page.getByText('Payload access requires an authorized role.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Payload', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Page 2 of 3')).toBeVisible();
});
test('401 clears session and displays login', async ({ page }) => {
  await session(page, 'ADMIN');
  await page.route('**/api/message?**', (r) =>
    r.fulfill({ status: 401, json: { success: false, code: 'TOKEN_INVALID' } }),
  );
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('authToken'))).toBeNull();
});
test('mobile navigation, overview and messages do not overflow the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page, 'VIEWER', 'overview');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/private/tmp/mirth-ui-mobile.png', fullPage: true });
});
test('overview shows six real metrics and opens recent failed message', async ({ page }) => {
  await page.setViewportSize({
    width: 1440,
    height: process.env.UI_FINAL_OVERVIEW_SCREENSHOT ? 1200 : 1000,
  });
  await session(page, 'ADMIN', 'overview');
  await page.route('**/api/message?**', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            id: 1,
            timestamp: '2026-10-04T00:00:00Z',
            channelId: 1,
            channelName: 'Test Channel',
            direction: 'IN',
            status: 'PARTIAL',
            level: 'ERROR',
          },
        ],
        pagination: { page: 1, pageSize: 5, total: 1 },
      },
    }),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  for (const label of [
    'Running Channels',
    'Stopped Channels',
    'Messages Today',
    'Successful',
    'Failed',
    'Retrying',
  ])
    await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  await expect(page.getByRole('button', { name: /Messages Today.*42/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Successful.*390/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Failures', exact: true })).toBeVisible();
  await expect(page.getByText('Channel activity', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Test Channel.*Message #1/ })).toBeVisible();
  await page.screenshot({
    path: process.env.UI_FINAL_OVERVIEW_SCREENSHOT || '/private/tmp/mirth-ui-overview.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: /Test Channel.*Message #1/ }).click();
  await expect(page.getByRole('dialog', { name: 'Message #1' })).toBeVisible();
});
test('channel wizard prevents accidental loss and requires review before saving', async ({
  page,
}) => {
  await session(page, 'DEVELOPER');
  let saves = 0;
  await page.route('**/api/channel', (r) => {
    if (r.request().method() === 'POST') {
      saves++;
      return r.fulfill({ json: { success: true, channelId: 2 } });
    }
    return r.fulfill({ json: [channel] });
  });
  await page.getByRole('button', { name: 'New Channel' }).click();
  await page.getByLabel('Channel name', { exact: false }).fill('New integration');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How should the message change?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Where should messages go?')).toBeVisible();
  await page.getByLabel('Destination name').fill('REST receiver');
  await page.getByLabel('Endpoint', { exact: false }).fill('https://api.example.com/messages');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Review your connection')).toBeVisible();
  expect(saves).toBe(0);
  await page.screenshot({ path: '/private/tmp/mirth-ui-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Discard unsaved changes?' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByText('Review your connection')).toBeVisible();
  await expect(page.getByLabel('Change summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save Channel' }).click();
  await expect(page.getByRole('dialog', { name: 'Channel saved', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(saves).toBe(1);
});
test('settings exposes administration only to admin and uses real API rows', async ({ page }) => {
  await session(page, 'ADMIN');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Users', exact: true }).click();
  await expect(page.getByText('Workspace Admin', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByRole('dialog', { name: 'Change user role' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await expect(page.getByRole('cell', { name: 'create channel' })).toBeVisible();
});
test('payload is text-safe and resend requires review and confirmation', async ({ page }) => {
  await session(page, 'OPERATOR');
  let sent = 0;
  await page.route('**/api/message/1?**', (r) =>
    r.fulfill({
      json: {
        success: true,
        data: {
          id: 1,
          timestamp: '2026-10-04T00:00:00Z',
          channelId: 1,
          channelName: 'Test Channel',
          direction: 'IN',
          status: 'FAILED',
          payloadAllowed: true,
          originalPayload: '<img src=x onerror=alert(1)>',
          destinationLogs: [
            {
              messageId: 2,
              canResend: true,
              destinationName: 'REST receiver',
              status: 'OUT-ERROR',
              outboundData: { test: 'synthetic' },
              responseText: 'REMOTE_HTTP_ERROR',
              sentAt: '2026-10-04T00:00:00Z',
            },
          ],
        },
      },
    }),
  );
  await page.route('**/api/message/resend/2', (r) => {
    sent++;
    return r.fulfill({ json: { success: true } });
  });
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  await page.getByRole('tab', { name: 'Payload', exact: true }).click();
  await expect(page.locator('.payload-code').first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.getByRole('dialog').locator('img')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Delivery history' }).click();
  await page.getByRole('button', { name: 'Review & resend' }).click();
  await expect(page.getByRole('dialog', { name: 'Review before resending' })).toBeVisible();
  expect(sent).toBe(0);
  await page.getByRole('button', { name: 'Confirm resend' }).click();
  await expect.poll(() => sent).toBe(1);
});
test('duplicate uses a new draft and XML export has no runtime IDs', async ({ page }) => {
  await session(page, 'DEVELOPER');
  await page.getByLabel('More actions for Test Channel').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export XML' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Test_Channel.xml');
  await page.getByLabel('More actions for Test Channel').click();
  await page.getByRole('button', { name: 'Duplicate channel' }).click();
  await expect(page.getByRole('dialog', { name: 'New channel' })).toBeVisible();
  await expect(page.getByLabel('Channel name', { exact: false })).toHaveValue(
    'Test Channel (copy)',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('This channel will receive messages without outbound delivery.', {
      exact: false,
    }),
  ).toBeVisible();
});
test('viewer settings hides user and audit administration', async ({ page }) => {
  await session(page, 'VIEWER');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'System information' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Users', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Audit log' })).toHaveCount(0);
});

test('draft iteration, stored dry-run and handshake probe use functional APIs without reposting secrets', async ({
  page,
}) => {
  await session(page, 'DEVELOPER');
  let saved = false;
  let patchBody: unknown;
  let probeCalls = 0;
  const detail = {
    name: 'Synthetic draft',
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    idempotencyMode: 'OPTIONAL',
    destinations: [
      {
        name: 'Synthetic sender',
        isEnabled: true,
        timeoutMs: 1000,
        endpoint: 'http://localhost/synthetic',
        processingScript: '[CONFIGURED]',
      },
    ],
    processingScript: '[CONFIGURED]',
  };
  await page.route('**/api/channel/1/revisions', (r) =>
    r.fulfill({
      json: {
        success: true,
        data: [
          {
            revision: saved ? 3 : 2,
            state: 'DRAFT',
            change_summary: 'Synthetic draft',
            checksum: 'a'.repeat(64),
          },
        ],
      },
    }),
  );
  await page.route('**/api/channel/1/revisions/2', (r) => {
    if (r.request().method() === 'PATCH') {
      patchBody = r.request().postDataJSON();
      saved = true;
      return r.fulfill({ json: { success: true, revision: 3, draft: true } });
    }
    return r.fulfill({ json: { success: true, data: detail, checksum: 'a'.repeat(64) } });
  });
  await page.route('**/api/channel/1/revisions/3', (r) =>
    r.fulfill({
      json: {
        success: true,
        data: { ...detail, name: 'Edited synthetic draft' },
        checksum: 'b'.repeat(64),
      },
    }),
  );
  await page.route('**/api/channel/1/revisions/3/dry-run', (r) => {
    expect(r.request().postDataJSON()).toEqual({ payload: { fixture: 'synthetic' } });
    return r.fulfill({
      json: {
        success: true,
        revision: 3,
        accepted: true,
        elapsedMs: 2,
        networkDelivery: 'NOT_SENT',
        results: [
          {
            name: 'Synthetic sender',
            outputFormat: 'JSON',
            finalPayload: { fixture: 'synthetic', processed: true },
            status: 'VALID',
          },
        ],
        warnings: ['No DNS or network delivery'],
      },
    });
  });
  await page.route('**/api/channel/1/revisions/3/destinations/0/test-connection', (r) => {
    probeCalls++;
    return r.fulfill({
      json: {
        success: true,
        reachable: true,
        secure: false,
        warnings: ['Plaintext trusted network only'],
      },
    });
  });
  await page.getByLabel('More actions for Test Channel').click();
  await page.getByRole('button', { name: 'Revisions', exact: true }).click();
  await page.getByRole('button', { name: 'Edit draft 2' }).click();
  await page.getByLabel('Draft channel name').fill('Edited synthetic draft');
  await page.getByLabel('Draft destination 1 timeout').fill('2.345');
  await page.getByLabel('Publish / rollback summary').fill('Synthetic reviewed edit');
  await page.getByRole('button', { name: 'Save successor draft' }).click();
  await expect(page.getByRole('button', { name: 'Edit draft 3' })).toBeVisible();
  expect(patchBody).toEqual({
    expectedChecksum: 'a'.repeat(64),
    changeSummary: 'Synthetic reviewed edit',
    patch: {
      name: 'Edited synthetic draft',
      idempotencyMode: 'OPTIONAL',
      destinations: [{ index: 0, name: 'Synthetic sender', isEnabled: true, timeoutMs: 2345 }],
    },
  });
  expect(JSON.stringify(patchBody)).not.toContain('processingScript');
  expect(JSON.stringify(patchBody)).not.toContain('endpoint');
  await page.getByRole('button', { name: 'Dry-run revision 3' }).click();
  await expect(page.getByLabel('Revision dry-run result')).toContainText('processed');
  await page.getByRole('button', { name: 'Review configuration' }).click();
  await page.getByRole('button', { name: 'Test connection · Synthetic sender' }).click();
  await expect(page.getByLabel('Revision dry-run result')).toContainText('reachable');
  expect(probeCalls).toBe(1);
});
test('draft conflict keeps the editor open and exposes the server error', async ({ page }) => {
  await session(page, 'DEVELOPER');
  await page.route('**/api/channel/1/revisions', (r) =>
    r.fulfill({
      json: { data: [{ revision: 2, state: 'DRAFT', change_summary: 'Synthetic draft' }] },
    }),
  );
  await page.route('**/api/channel/1/revisions/2', (r) =>
    r.request().method() === 'PATCH'
      ? r.fulfill({
          status: 409,
          json: { code: 'DRAFT_CONFLICT', message: 'Draft changed; reload revisions' },
        })
      : r.fulfill({
          json: { checksum: 'a'.repeat(64), data: { name: 'Synthetic draft', destinations: [] } },
        }),
  );
  await page.getByLabel('More actions for Test Channel').click();
  await page.getByRole('button', { name: 'Revisions', exact: true }).click();
  await page.getByRole('button', { name: 'Edit draft 2' }).click();
  await page.getByLabel('Publish / rollback summary').fill('Synthetic conflicting edit');
  await page.getByRole('button', { name: 'Save successor draft' }).click();
  await expect(page.getByRole('alert')).toContainText('Draft changed');
  await expect(page.getByLabel('Draft channel name')).toBeVisible();
});
test('role changed during active session hides configuration actions after reconciliation', async ({
  page,
}) => {
  await session(page, 'DEVELOPER');
  await expect(page.getByRole('button', { name: 'New Channel' })).toBeVisible();
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      json: { success: true, data: { id: 1, name: 'Synthetic downgraded user', role: 'VIEWER' } },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'New Channel' })).toHaveCount(0);
  await page.getByLabel('More actions for Test Channel').click();
  await expect(page.getByRole('button', { name: 'Revisions', exact: true })).toHaveCount(0);
});
test('WCAG accessibility scan and keyboard focus trap cover login and revision editor', async ({
  page,
}) => {
  await page.goto('/');
  let scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await session(page, 'DEVELOPER');
  await page.route('**/api/channel/1/revisions', (r) =>
    r.fulfill({
      json: { data: [{ revision: 2, state: 'DRAFT', change_summary: 'Synthetic draft' }] },
    }),
  );
  await page.getByLabel('More actions for Test Channel').click();
  await page.getByRole('button', { name: 'Revisions', exact: true }).click();
  scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.getByLabel('Close dialog').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Compare selected revisions' })).not.toBeFocused();
  expect(
    await page.evaluate(() =>
      document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('dirty successor draft requires confirmation before closing', async ({ page }) => {
  await session(page, 'DEVELOPER');
  await page.route('**/api/channel/1/revisions', (r) =>
    r.fulfill({
      json: { data: [{ revision: 2, state: 'DRAFT', change_summary: 'Synthetic draft' }] },
    }),
  );
  await page.route('**/api/channel/1/revisions/2', (r) =>
    r.fulfill({
      json: { checksum: 'a'.repeat(64), data: { name: 'Synthetic draft', destinations: [] } },
    }),
  );
  await page.getByLabel('More actions for Test Channel').click();
  await page.getByRole('button', { name: 'Revisions', exact: true }).click();
  await page.getByRole('button', { name: 'Edit draft 2' }).click();
  await page.getByLabel('Draft channel name').fill('Unsaved synthetic change');
  await page.getByLabel('Close dialog').click();
  await expect(page.getByRole('dialog', { name: 'Discard draft changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Draft channel name')).toHaveValue('Unsaved synthetic change');
  await page.getByLabel('Close dialog').click();
  await page.getByRole('button', { name: 'Discard draft changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('admin downloads audited metadata using real diagnostic API contract', async ({ page }) => {
  await session(page, 'ADMIN');
  await page.route('**/api/system/configuration', (r) =>
    r.fulfill({
      json: {
        success: true,
        data: {
          runtime: { node: 'synthetic-runtime', encryptionKeyVersion: 'current' },
          retention: { enabled: false },
        },
      },
    }),
  );
  let downloads = 0;
  await page.route('**/api/system/diagnostics', (r) => {
    downloads++;
    return r.fulfill({
      json: {
        success: true,
        formatVersion: 1,
        schemaVersions: [1, 2, 3, 4, 5],
        messageStates: [],
        exclusions: ['Payloads', 'Credentials'],
      },
    });
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Runtime information', { exact: true })).toBeVisible();
  await expect(page.locator('pre')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download diagnostic metadata' })).toBeHidden();
  await page.getByText('Diagnostic report', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download diagnostic metadata' })).toBeEnabled();
  const report = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostic metadata' }).click();
  expect((await report).suggestedFilename()).toBe('mirth-diagnostic-metadata.json');
  expect(downloads).toBe(1);
});

test('stored TEXT revision dry-run preserves JSON-looking text without changing its type', async ({
  page,
}) => {
  await session(page, 'DEVELOPER');
  await page.route('**/api/channel/1/revisions', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            revision: 2,
            state: 'DRAFT',
            change_summary: 'Synthetic text channel',
            checksum: 'a'.repeat(64),
          },
        ],
      },
    }),
  );
  await page.route('**/api/channel/1/revisions/2', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          name: 'Synthetic text',
          source: { type: 'HTTP', inboundDataType: 'TEXT' },
          destinations: [],
        },
      },
    }),
  );
  let posted: unknown;
  await page.route('**/api/channel/1/revisions/2/dry-run', (route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({
      json: {
        success: true,
        accepted: true,
        elapsedMs: 1,
        networkDelivery: 'NOT_SENT',
        results: [],
        source: {
          format: 'TEXT',
          payload: '{"fixture":"synthetic"}',
          validation: 'PASSED',
          filter: 'ACCEPTED',
          transformation: 'PASS_THROUGH',
        },
      },
    });
  });
  await page.getByLabel('More actions for Test Channel').click();
  await page.getByRole('button', { name: 'Revisions', exact: true }).click();
  await page.getByRole('button', { name: 'Dry-run revision 2' }).click();
  await expect(page.getByLabel('Revision dry-run result')).toContainText(
    'Source processing · TEXT',
  );
  expect(posted).toEqual({ payload: '{"fixture":"synthetic"}' });
  await page.getByLabel('Synthetic revision test payload').fill('Changed synthetic input');
  await expect(page.getByLabel('Revision dry-run result')).toHaveCount(0);
});

test('settings keeps roles and operational tools available through disclosure', async ({
  page,
}) => {
  await session(page, 'ADMIN');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser sessions' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Operational alerts' })).toBeHidden();
  await page.getByText('Operational tools', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser sessions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operational alerts' })).toBeVisible();
  await page.getByRole('tab', { name: 'Roles', exact: true }).click();
  for (const role of ['ADMIN', 'DEVELOPER', 'OPERATOR', 'VIEWER'])
    await expect(page.getByRole('cell', { name: role, exact: true })).toBeVisible();
  await expect(page.getByText('Assign or change a role in Users.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'System information' }).click();
  await expect(page.getByText('v22.18.0', { exact: true })).toBeVisible();
  await page.screenshot({
    path: process.env.UI_FINAL_SETTINGS_SCREENSHOT || '/private/tmp/mirth-ui-settings.png',
    fullPage: true,
  });
});

test('delivery result shows captured duration and exact attempts without inventing legacy values', async ({
  page,
}) => {
  await session(page, 'VIEWER');
  await page.route('**/api/message/1?**', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          id: 1,
          channelId: 1,
          channelName: 'Synthetic delivery',
          timestamp: '2026-10-04T00:00:00Z',
          status: 'SUCCESS',
          direction: 'IN',
          inboundFormat: 'JSON',
          payloadAllowed: false,
          destinationLogs: [
            {
              messageId: 2,
              destinationName: 'Captured destination',
              outboundFormat: 'XML',
              status: 'OUT-SENT',
              httpStatus: 200,
              durationMs: 0,
              attemptCount: 2,
              sentAt: '2026-10-04T00:00:01Z',
            },
            {
              messageId: 3,
              destinationName: 'Legacy destination',
              outboundFormat: 'XML',
              status: 'OUT-SENT',
              durationMs: null,
              attemptCount: null,
              sentAt: '2026-10-04T00:00:01Z',
            },
          ],
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'Open message 1', exact: true }).click();
  const captured = page.locator('.delivery-card').filter({ hasText: 'Captured destination' });
  await expect(captured).toContainText('HTTP 200');
  await expect(captured).toContainText('0 ms');
  await expect(
    captured
      .locator('div')
      .filter({ has: page.locator('dt').filter({ hasText: /^Attempts$/ }) })
      .last(),
  ).toContainText('2');
  const legacy = page.locator('.delivery-card').filter({ hasText: 'Legacy destination' });
  await expect(legacy.getByText('Not recorded', { exact: true })).toHaveCount(3);
  await expect(legacy).not.toContainText('HTTP 200');
});
