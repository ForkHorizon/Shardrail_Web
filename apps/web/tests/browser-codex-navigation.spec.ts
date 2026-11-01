import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const binary = resolve(process.env.SHARDRAILD_BIN ?? '../../target/release/shardraild');
const assets = resolve(process.env.SHARDRAIL_E2E_ASSETS_DIR ?? 'dist');
const fakeCodex = resolve(new URL('fixtures/fake_codex_app_server.py', import.meta.url).pathname);

let daemon: ChildProcess | null = null;
let dataDir = '';
let workdir = '';
let baseUrl = '';

async function stopDaemon() {
  const child = daemon;
  daemon = null;
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolveDone) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveDone();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveDone();
    });
  });
}

async function pair(page: Page) {
  const args = ['--data-dir', dataDir, 'client', 'enroll', '--label', `Playwright codex nav ${randomUUID()}`, '--allow-session-create'];
  const code = execFileSync(binary, args, { encoding: 'utf8' }).match(/enrollment_code=([0-9a-f]+)/)?.[1];
  if (!code) throw new Error('shardraild did not issue an enrollment code');
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Review fingerprint' }).click();
  await page.getByRole('textbox', { name: 'One-time enrollment code' }).fill(code);
  await page.getByRole('button', { name: 'I verified this fingerprint — pair' }).click();
  await expect(page.getByRole('heading', { name: 'Shardrail' })).toBeVisible();
  await expect(page.getByText('Connected · browser WebSocket')).toBeVisible();
}

test.beforeAll(async () => {
  await chmod(fakeCodex, 0o755);
  dataDir = await mkdtemp(`${tmpdir()}/shardrail-codex-nav-`);
  workdir = await mkdtemp(`${tmpdir()}/shardrail-codex-nav-work-`);
  daemon = spawn(binary, [
    '--data-dir', dataDir,
    '--no-file-log',
    '--codex-app-server', fakeCodex,
    '--session-workdir', workdir,
    '--browser-listen', '127.0.0.1:0',
    '--browser-assets-dir', assets,
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, SHARDRAIL_CODEX_FAKE_MODE: 'happy' },
  });

  let stderr = '';
  baseUrl = await new Promise<string>((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`daemon did not listen: ${stderr}`)), 10_000);
    daemon?.stderr?.setEncoding('utf8');
    daemon?.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      const port = stderr.match(/browser WebSocket listening at ws:\/\/127\.0\.0\.1:(\d+)\/ws/)?.[1];
      if (port) {
        clearTimeout(timer);
        resolveUrl(`http://127.0.0.1:${port}/`);
      }
    });
    daemon?.once('exit', (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`daemon exited ${code}: ${stderr}`));
    });
  });
});

test.afterAll(async () => {
  await stopDaemon();
  await rm(dataDir, { recursive: true, force: true });
  await rm(workdir, { recursive: true, force: true });
});

test('hierarchy navigation, session filtering, safe rendering, and accessibility', async ({ page }) => {
  test.setTimeout(60_000);

  // 1. Pair browser client
  await pair(page);

  // 2. Hierarchy navigation bar should be visible
  const hierarchyNav = page.locator('.hierarchy-nav');
  await expect(hierarchyNav).toBeVisible();
  await expect(hierarchyNav.getByText('Local Machine')).toBeVisible();
  await expect(hierarchyNav.getByText('All agents')).toBeVisible();

  // Run Axe accessibility on empty state (desktop viewport)
  await page.setViewportSize({ width: 1280, height: 800 });
  const a11yInitial = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  expect(a11yInitial.violations).toEqual([]);

  // 3. Create a new Codex session
  await page.getByRole('button', { name: 'New session' }).click();
  const option = page.getByRole('option').filter({ hasText: /[0-9a-f]{8}-/ });
  await expect(option).toBeVisible({ timeout: 15_000 });

  const sessionText = await option.innerText();
  const sessionIdMatch = sessionText.match(/[0-9a-f]{8}-[0-9a-f-]{27}/);
  expect(sessionIdMatch).toBeTruthy();
  const sessionId = sessionIdMatch![0];

  // 4. Verify Hierarchy Breadcrumb updates to reflect selected session
  await expect(hierarchyNav.getByText(sessionId.slice(0, 8))).toBeVisible();

  // 5. Verify Filter and Search Bar
  const searchInput = page.getByRole('textbox', { name: 'Search sessions' });
  await expect(searchInput).toBeVisible();

  // Filter with matching query
  await searchInput.fill(sessionId.slice(0, 4));
  await expect(page.getByRole('option')).toHaveCount(1);

  // Filter with non-matching query
  await searchInput.fill('nonexistent-session-xyz');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.getByText('No sessions match the selected filters')).toBeVisible();

  // Reset filters
  await page.locator('.reset-filters-button').click();
  await expect(page.getByRole('option')).toHaveCount(1);

  // 6. Send prompt to generate turn events in safe mode
  await page.locator('#session-prompt').fill('Test command execution and diff safe rendering');
  await page.getByRole('button', { name: 'Send prompt' }).click();

  // Wait for activity / approval / transcript
  const denyButton = page.getByRole('button', { name: 'Deny' });
  await expect(denyButton).toBeVisible({ timeout: 15_000 });

  // 7. Verify safe mode rendering labels and untrusted sanitization
  await expect(page.locator('.host-banner')).toBeVisible();
  await expect(page.locator('.transcript')).toBeVisible();

  // Verify that any rendered markdown or untrusted output is strictly non-executable
  const rawScripts = await page.locator('.transcript script').count();
  expect(rawScripts).toBe(0);

  // 8. Run Axe accessibility check on session view (desktop)
  const a11yDesktop = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  expect(a11yDesktop.violations).toEqual([]);

  // Cleanly deny the pending approval while on desktop
  await denyButton.click();

  // 9. Verify Mobile Viewport responsiveness & accessibility
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(hierarchyNav).toBeVisible();

  const a11yMobile = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  expect(a11yMobile.violations).toEqual([]);
});
