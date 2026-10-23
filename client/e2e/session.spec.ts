import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const initialTime = Date.parse('2026-10-21T02:00:00.000Z');
const idleMs = 15 * 60 * 1000;
const absoluteMs = 8 * 60 * 60 * 1000;
const sessionId = '11111111-2222-4333-8444-555555555555';

async function sessionFixture(context: BrowserContext) {
  const state = {
    createdAt: initialTime,
    lastActivity: initialTime,
    active: false,
    refreshes: 0,
    activities: 0,
    logouts: 0,
    failLogout: false,
    delayNextLogout: false,
    delayedLogout: undefined as undefined | (() => Promise<void>),
    delayNextRefresh: false,
    delayedRefresh: undefined as undefined | (() => Promise<void>),
  };
  const metadata = (now: number) => ({
    idleTimeoutSeconds: 900,
    warningSeconds: 60,
    idleExpiresAt: new Date(state.lastActivity + idleMs).toISOString(),
    absoluteExpiresAt: new Date(state.createdAt + absoluteMs).toISOString(),
    serverTime: new Date(now).toISOString(),
  });
  const token = (now: number) =>
    `${Buffer.from('{}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ id: 1, sid: sessionId, exp: Math.floor(now / 1000) + 300 }),
    ).toString('base64url')}.synthetic-signature`;
  const reject = (route: Route, code: string) =>
    route.fulfill({
      status: 401,
      json: { success: false, code, message: 'Your session has expired. Sign in again.' },
    });
  await context.route('**/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await context.route('**/ready', (route) => route.fulfill({ json: { status: 'ready' } }));
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const page = route.request().frame().page();
    const now = await page.evaluate(() => Date.now());
    if (pathname === '/api/auth/browser/login') {
      state.active = true;
      state.createdAt = now;
      state.lastActivity = now;
      await context.addCookies([
        {
          name: 'mirth_csrf',
          value: 'synthetic-session-csrf',
          url: 'http://127.0.0.1:4173',
          sameSite: 'Strict',
        },
      ]);
      return route.fulfill({ json: { token: token(now), session: metadata(now) } });
    }
    if (pathname === '/api/auth/browser/logout') {
      state.logouts++;
      if (state.failLogout)
        return route.fulfill({
          status: 503,
          json: { success: false, code: 'DATABASE_UNAVAILABLE', message: 'Unable to sign out.' },
        });
      const respond = () => {
        state.active = false;
        return route.fulfill({ json: { success: true } });
      };
      if (state.delayNextLogout) {
        state.delayNextLogout = false;
        await new Promise<void>((resolve) => {
          state.delayedLogout = async () => {
            await respond();
            resolve();
          };
        });
        return;
      }
      return respond();
    }
    if (pathname.startsWith('/api/auth/')) {
      if (pathname === '/api/auth/browser/refresh') state.refreshes++;
      if (!state.active) return reject(route, 'SESSION_INVALID');
      if (now >= state.createdAt + absoluteMs) return reject(route, 'SESSION_ABSOLUTE_EXPIRED');
      if (now >= state.lastActivity + idleMs) return reject(route, 'SESSION_IDLE_EXPIRED');
      if (pathname === '/api/auth/browser/activity') {
        expect(route.request().headers()['x-csrf-token']).toBe('synthetic-session-csrf');
        expect(route.request().headers().authorization).toMatch(/^Bearer /);
        state.activities++;
        state.lastActivity = now;
        return route.fulfill({ json: { success: true, session: metadata(now) } });
      }
      if (pathname === '/api/auth/browser/refresh') {
        const respond = () =>
          route.fulfill({ json: { token: token(now), session: metadata(now) } });
        if (state.delayNextRefresh) {
          state.delayNextRefresh = false;
          await new Promise<void>((resolve) => {
            state.delayedRefresh = async () => {
              await respond();
              resolve();
            };
          });
          return;
        }
        return respond();
      }
      if (pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            success: true,
            data: { id: 1, name: 'Synthetic Admin', role: 'ADMIN' },
            session: metadata(now),
          },
        });
    }
    if (pathname === '/api/message/stats')
      return route.fulfill({
        json: {
          totalReceived: 0,
          totalSent: 0,
          totalErrors: 0,
          successfulMessages: 0,
          failedMessages: 0,
          retryingMessages: 0,
          channelsRunning: 0,
          channelsStopped: 0,
          channelsError: 0,
          messagesToday: 0,
          queuedMessages: 0,
          deadLetterMessages: 0,
        },
      });
    if (pathname === '/api/message')
      return route.fulfill({
        json: { success: true, data: [], pagination: { page: 1, pageSize: 50, total: 0 } },
      });
    if (pathname === '/api/channel') return route.fulfill({ json: [] });
    return route.fulfill({ json: { success: true, data: [] } });
  });
  return state;
}

async function login(page: Page) {
  await page.clock.install({ time: initialTime });
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('synthetic-admin');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}

test('idle warning appears one minute before expiry and explicit continue renews only idle', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  await login(page);
  await page.clock.fastForward(idleMs - 59000);
  const warning = page.getByRole('dialog', { name: 'Session expiring' });
  await expect(warning).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations).toEqual([]);
  expect(state.activities).toBe(0);
  await expect.poll(() => state.refreshes).toBeGreaterThan(0);
  const originalAbsolute = state.createdAt + absoluteMs;
  await warning.getByRole('button', { name: 'Continue session', exact: true }).click();
  await expect.poll(() => state.activities).toBeGreaterThan(0);
  await expect(warning).toBeHidden();
  expect(state.createdAt + absoluteMs).toBe(originalAbsolute);
  await page.clock.fastForward(60000);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});

test('background refresh and polling do not prevent logout after fifteen idle minutes', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  await login(page);
  for (let i = 0; i < 3; i++) {
    await page.clock.fastForward(5 * 60 * 1000 + 1);
    await page.waitForTimeout(1);
  }
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  expect(state.activities).toBe(0);
  expect(state.refreshes).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeHidden();
});

test('reopening after three days requires login instead of restoring the old cookie session', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  await login(page);
  await page.close();
  const reopened = await context.newPage();
  await reopened.clock.install({ time: initialTime + 3 * 24 * 60 * 60 * 1000 });
  await reopened.goto('/');
  await expect(reopened.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  expect(state.activities).toBe(0);
  await expect(reopened.getByRole('heading', { name: 'Overview', exact: true })).toBeHidden();
});

test('manual logout requires confirmation and Cancel or Escape keeps the session active', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  await login(page);
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  const confirmation = page.getByRole('dialog', { name: 'Log out', exact: true });
  await signOut.click();
  await expect(confirmation).toContainText('Are you sure you want to log out?');
  expect(state.logouts).toBe(0);
  expect(state.active).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations).toEqual([]);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(signOut).toBeFocused();
  expect(state.logouts).toBe(0);
  await signOut.click();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(signOut).toBeFocused();
  expect(state.active).toBe(true);
  expect(state.logouts).toBe(0);
  await signOut.click();
  const confirm = confirmation.getByRole('button', { name: 'Log out', exact: true });
  await confirm.focus();
  await page.keyboard.press('Tab');
  await expect(
    confirmation.getByRole('button', { name: 'Close dialog', exact: true }),
  ).toBeFocused();
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect.poll(() => state.logouts).toBe(1);
  expect(state.active).toBe(false);
});

test('Sign out from the session warning also asks for confirmation', async ({ page, context }) => {
  const state = await sessionFixture(context);
  await login(page);
  await page.clock.fastForward(idleMs - 59000);
  const warning = page.getByRole('dialog', { name: 'Session expiring', exact: true });
  await warning.getByRole('button', { name: 'Sign out', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Log out', exact: true });
  await expect(confirmation).toBeVisible();
  expect(state.logouts).toBe(0);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
  expect(state.activities).toBe(0);
  await warning.getByRole('button', { name: 'Sign out', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect.poll(() => state.logouts).toBe(1);
});

test('pending logout confirmation cannot block automatic session expiry or reappear after login', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  await login(page);
  await page.clock.fastForward(idleMs - 59000);
  await page
    .getByRole('dialog', { name: 'Session expiring', exact: true })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Log out', exact: true })).toBeVisible();
  expect(state.logouts).toBe(0);
  await page.clock.fastForward(60000);
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Log out', exact: true })).toHaveCount(0);
  await expect.poll(() => state.logouts).toBe(1);
  await page.getByLabel('Username', { exact: true }).fill('synthetic-admin');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Log out', exact: true })).toHaveCount(0);
});

test('logout is synchronized to another open tab', async ({ page, context }) => {
  await sessionFixture(context);
  await login(page);
  const other = await context.newPage();
  await other.clock.install({ time: initialTime });
  await other.goto('/');
  await expect(other.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Log out', exact: true })
    .getByRole('button', { name: 'Log out', exact: true })
    .click();
  await expect(other.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
});

test('successful pending logout never flashes a failure warning in either tab', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  await login(page);
  const other = await context.newPage();
  await other.clock.install({ time: initialTime });
  await other.goto('/');
  await expect(other.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  for (const tab of [page, other])
    await tab.evaluate(() => {
      const observed = { failureSeen: false };
      Object.assign(window, { __logoutObservation: observed });
      new MutationObserver(() => {
        if (document.querySelector('.session-logout-warning')) observed.failureSeen = true;
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  state.delayNextLogout = true;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Log out', exact: true })
    .getByRole('button', { name: 'Log out', exact: true })
    .click();
  await expect.poll(() => !!state.delayedLogout).toBe(true);
  try {
    for (const tab of [page, other]) {
      await expect(tab.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
      await expect(tab.getByText('Sign out could not be confirmed', { exact: true })).toHaveCount(
        0,
      );
    }
    await expect(page.getByRole('status').filter({ hasText: 'Signing out…' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  } finally {
    await state.delayedLogout!();
  }
  for (const tab of [page, other]) {
    await expect(tab.getByRole('status').filter({ hasText: 'Signing out…' })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    expect(
      await tab.evaluate(
        () =>
          (window as Window & { __logoutObservation: { failureSeen: boolean } }).__logoutObservation
            .failureSeen,
      ),
    ).toBe(false);
  }
  expect(state.logouts).toBe(1);
  expect(state.active).toBe(false);
});

test('retrying a failed logout shows progress until the new request finishes', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  await login(page);
  state.failLogout = true;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Log out', exact: true })
    .getByRole('button', { name: 'Log out', exact: true })
    .click();
  await expect(page.getByText('Sign out could not be confirmed', { exact: true })).toBeVisible();
  state.failLogout = false;
  state.delayNextLogout = true;
  await page.getByRole('button', { name: 'Retry sign out', exact: true }).click();
  await expect.poll(() => !!state.delayedLogout).toBe(true);
  try {
    await expect(page.getByText('Sign out could not be confirmed', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Signing out…' })).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  } finally {
    await state.delayedLogout!();
  }
  await expect(page.getByRole('status').filter({ hasText: 'Signing out…' })).toHaveCount(0);
  await expect(page.getByText('Sign out could not be confirmed', { exact: true })).toHaveCount(0);
  expect(state.logouts).toBe(2);
  expect(state.active).toBe(false);
});

test('persisted pending logout on reload remains blocked and offers an interruption retry', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  state.active = true;
  await context.addCookies([
    {
      name: 'mirth_csrf',
      value: 'synthetic-session-csrf',
      url: 'http://127.0.0.1:4173',
      sameSite: 'Strict',
    },
  ]);
  await page.clock.install({ time: initialTime });
  await page.addInitScript(() =>
    localStorage.setItem(
      'mirth.logout-intent',
      JSON.stringify({ state: 'pending', nonce: 'synthetic-interrupted-logout' }),
    ),
  );
  await page.goto('/');
  await expect(page.getByText('Sign out could not be confirmed', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toHaveCount(0);
  expect(state.refreshes).toBe(0);
  await page.getByRole('button', { name: 'Retry sign out', exact: true }).click();
  await expect(page.getByText('Sign out could not be confirmed', { exact: true })).toHaveCount(0);
  await expect.poll(() => state.active).toBe(false);
  expect(state.logouts).toBe(1);
  expect(state.refreshes).toBe(0);
});

test('failed server logout blocks automatic restore across reload and offers retry', async ({
  page,
  context,
}) => {
  const state = await sessionFixture(context);
  await login(page);
  state.failLogout = true;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Log out', exact: true })
    .getByRole('button', { name: 'Log out', exact: true })
    .click();
  await expect(page.getByText(/Sign out could not be confirmed/)).toBeVisible();
  const previousRefreshes = state.refreshes;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  expect(state.refreshes).toBe(previousRefreshes);
  state.failLogout = false;
  await page.getByRole('button', { name: 'Retry sign out', exact: true }).click();
  await expect.poll(() => state.active).toBe(false);
  await expect(page.getByText(/Sign out could not be confirmed/)).toBeHidden();
});

test('a delayed refresh cannot restore the dashboard after logout', async ({ page, context }) => {
  const state = await sessionFixture(context);
  await login(page);
  state.delayNextRefresh = true;
  await page.clock.fastForward(300001);
  await expect.poll(() => !!state.delayedRefresh).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Log out', exact: true })
    .getByRole('button', { name: 'Log out', exact: true })
    .click();
  await state.delayedRefresh!();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect.poll(() => state.active).toBe(false);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeHidden();
});

test('failed logout remains blocked after reload when localStorage is unavailable', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Storage is unavailable', 'SecurityError');
      },
    });
  });
  const state = await sessionFixture(context);
  await login(page);
  state.failLogout = true;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Log out', exact: true })
    .getByRole('button', { name: 'Log out', exact: true })
    .click();
  await expect(page.getByText(/Sign out could not be confirmed/)).toBeVisible();
  const previousRefreshes = state.refreshes;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  expect(state.refreshes).toBe(previousRefreshes);
  state.failLogout = false;
  await page.getByRole('button', { name: 'Retry sign out', exact: true }).click();
  await expect.poll(() => state.active).toBe(false);
});

test('ongoing user activity cannot extend the eight hour absolute session lifetime', async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const state = await sessionFixture(context);
  await login(page);
  const originalCreatedAt = state.createdAt;
  for (let i = 0; i < 47; i++) {
    await page.clock.fastForward(10 * 60 * 1000);
    const previous = state.activities;
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => state.activities).toBeGreaterThan(previous);
  }
  expect(state.createdAt).toBe(originalCreatedAt);
  await page.clock.fastForward(10 * 60 * 1000 + 1);
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeHidden();
});
