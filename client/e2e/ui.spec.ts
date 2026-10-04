import { test, expect, Page } from '@playwright/test';
// Synthetic browser fixtures. No writes to the real workspace database.
const channel = {
  id: 1,
  name: 'Test Channel',
  status: 'STOPPED',
  source: { type: 'HTTP', endpoint: '/api/inbound/1' },
  destinations: [],
  received: 0,
};
const token =
  'eyJhbGciOiJIUzI1NiJ9.' +
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') +
  '.test-signature';
async function session(page: Page, role: string, view: 'overview' | 'channels' = 'channels') {
  await page.route('**/health', (r) => r.fulfill({ json: { status: 'ok' } }));
  await page.route('**/ready', (r) => r.fulfill({ json: { status: 'ready' } }));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/login') return route.fulfill({ json: { token } });
    if (url.pathname === '/api/auth/me')
      return route.fulfill({ json: { success: true, data: { id: 1, name: 'Test', role } } });
    if (url.pathname === '/api/channel') return route.fulfill({ json: [channel] });
    if (url.pathname === '/api/message/stats')
      return route.fulfill({
        json: {
          totalReceived: 420,
          totalSent: 400,
          totalErrors: 2,
          channelsRunning: 1,
          channelsStopped: 0,
          channelsError: 0,
          messagesToday: 42,
          queuedMessages: 3,
          deadLetterMessages: 0,
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
test('overview shows actual metrics and navigates to attention channel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await session(page, 'ADMIN', 'overview');
  await expect(page.getByRole('button', { name: /Received today.*42/ })).toBeVisible();
  await expect(page.getByText('Database ready', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/private/tmp/mirth-ui-overview.png', fullPage: true });
  await page.getByRole('button', { name: /Test Channel.*No enabled destination/ }).click();
  await expect(page.getByLabel('Search channels')).toHaveValue('#1');
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
  await expect(page.getByText('Prepare messages for delivery')).toBeVisible();
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
  await page.getByRole('button', { name: 'Save Channel' }).click();
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
  await expect(page.getByRole('tab', { name: 'Account & connection' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Users', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Audit log' })).toHaveCount(0);
});
