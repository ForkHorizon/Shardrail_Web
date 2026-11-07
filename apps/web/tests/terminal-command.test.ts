// Covers provider resume commands and active-writer protection.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionIsLocked, terminalResumeCommand } from '../src/terminal-command';

test('terminal launch resumes the selected Codex or Claude session', () => {
  assert.deepEqual(terminalResumeCommand('codex', 'thread-1'), { command: 'codex', args: ['resume', 'thread-1'] });
  assert.deepEqual(terminalResumeCommand('claude_code', 'session-1'), { command: 'claude', args: ['--resume', 'session-1'] });
  assert.equal(terminalResumeCommand('antigravity', 'session-1'), null);
});

test('terminal launch blocks sessions already locked by another writer', () => {
  assert.equal(sessionIsLocked('locked_elsewhere'), true);
  assert.equal(sessionIsLocked('idle'), false);
});
