// Verifies that browser reload restores the terminal and daemon PTY scrollback.
import { test, expect, type Page } from '@playwright/test';
import { connect } from '@shardrail/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type State = { baseUrl: string; dataDir: string; clientId: string; publicKey: string; privateKey: string; hostPublicKey: string };
const stateFile = process.env.SHARDRAIL_E2E_STATE ?? join(tmpdir(), 'shardrail-browser-e2e-state.json');
const state = JSON.parse(await readFile(stateFile, 'utf8')) as State;

async function pair(page: Page) {
  const binary = process.env.SHARDRAILD_BIN ?? '../../target/debug/shardraild';
  const code = execFileSync(binary, ['--data-dir', state.dataDir, 'client', 'enroll-terminal', '--label', `Playwright terminal ${randomUUID()}`], { encoding: 'utf8' }).match(/enrollment_code=([0-9a-f]+)/)?.[1];
  if (!code) throw new Error('shardraild did not issue an enrollment code');
  await page.goto(state.baseUrl);
  await page.getByRole('button', { name: 'Review fingerprint' }).click();
  await page.getByRole('textbox', { name: 'One-time enrollment code' }).fill(code);
  await page.getByRole('button', { name: 'I verified this fingerprint — pair' }).click();
  await expect(page.getByRole('heading', { name: 'Shardrail' })).toBeVisible();
  await expect(page.getByText('Connected · browser WebSocket')).toBeVisible();
}

async function terminalCommand(kind: 'terminal.spawn' | 'terminal.input' | 'terminal.close', sessionId: string) {
  const commandId = randomUUID();
  const client = await connect({
    socketPath: join(state.dataDir, 'shardraild.sock'), clientId: state.clientId,
    publicKey: state.publicKey, privateKey: Uint8Array.from(Buffer.from(state.privateKey, 'hex')),
    hostPublicKey: state.hostPublicKey,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${kind} was not acknowledged`)), 10_000);
      client.onFrame((frame) => {
        if (frame.kind === 'command_accepted' && frame.command_id === commandId) { clearTimeout(timer); resolve(); }
        else if (frame.kind === 'command_rejected' && frame.command_id === commandId) { clearTimeout(timer); reject(new Error(frame.error)); }
      });
      client.request({
        command_id: commandId, kind, expected_state: null, expected_turn_id: null,
        payload: kind === 'terminal.spawn'
          ? { session_id: sessionId, command: '/bin/sh', args: [] }
          : kind === 'terminal.input' ? { session_id: sessionId, data: "printf 'TERMINAL_RELOAD_SENTINEL\\n'\n" } : { session_id: sessionId },
      });
    });
  } finally { client.close(); }
}

test('terminal session and view restore after browser reload and replay scrollback', async ({ page }) => {
  test.setTimeout(60_000);
  await pair(page);
  const sessionId = '01940000-0000-7000-8000-000000000099';
  let terminalSpawned = false;
  try {
    await terminalCommand('terminal.spawn', sessionId);
    terminalSpawned = true;
    const option = page.getByRole('option', { name: new RegExp(sessionId) });
    await expect(option).toBeVisible();
    await option.focus();
    await expect(page.getByRole('heading', { name: `Events for ${sessionId.slice(0, 8)}` })).toBeVisible();
    await page.getByRole('button', { name: 'Terminal' }).click();
    const screen = page.getByRole('region', { name: 'Terminal output stream' });
    await terminalCommand('terminal.input', sessionId);
    await expect(screen).toContainText('TERMINAL_RELOAD_SENTINEL', { timeout: 15_000 });
    const outputCopies = (await screen.innerText()).match(/TERMINAL_RELOAD_SENTINEL/g)?.length ?? 0;
    expect(outputCopies).toBeGreaterThan(0);

    await page.reload();
    await expect(page.getByText('Connected · browser WebSocket')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: `Events for ${sessionId.slice(0, 8)}` })).toBeVisible({ timeout: 15_000 });
    const restoredScreen = page.getByRole('region', { name: 'Terminal output stream' });
    await expect(restoredScreen).toContainText('TERMINAL_RELOAD_SENTINEL', { timeout: 15_000 });
    expect((await restoredScreen.innerText()).match(/TERMINAL_RELOAD_SENTINEL/g)?.length ?? 0).toBe(outputCopies);
  } finally {
    if (terminalSpawned) await terminalCommand('terminal.close', sessionId);
  }
});
