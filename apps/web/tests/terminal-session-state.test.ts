// Verifies machine-scoped session and terminal view persistence.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  persistSelectedSession,
  persistTerminalView,
  restoreSelectedSession,
  restoreTerminalView,
  selectedSessionStorageKey,
  terminalViewStorageKey,
  type TerminalStateStorage,
} from '../src/terminal-session-state';

class MemoryStorage implements TerminalStateStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('selected session survives reload and is isolated by machine', () => {
  const storage = new MemoryStorage();
  persistSelectedSession(storage, 'machine/one', 'session-1');
  assert.equal(storage.getItem(selectedSessionStorageKey('machine/one')), 'session-1');
  assert.equal(restoreSelectedSession(storage, 'machine/one'), 'session-1');
  assert.equal(restoreSelectedSession(storage, 'machine/two'), null);
  persistSelectedSession(storage, 'machine/one', null);
  assert.equal(restoreSelectedSession(storage, 'machine/one'), null);
});

test('terminal mode survives reload independently for each machine and session', () => {
  const storage = new MemoryStorage();
  persistTerminalView(storage, 'machine/one', 'session-1', 'terminal');
  assert.equal(restoreTerminalView(storage, 'machine/one', 'session-1'), 'terminal');
  assert.equal(restoreTerminalView(storage, 'machine/two', 'session-1'), 'chat');
  assert.equal(restoreTerminalView(storage, 'machine/one', 'session-2'), 'chat');
  persistTerminalView(storage, 'machine/one', 'session-1', 'chat');
  assert.equal(restoreTerminalView(storage, 'machine/one', 'session-1'), 'chat');
  assert.notEqual(terminalViewStorageKey('machine/one', 'session/1'), terminalViewStorageKey('machine/one', 'session:1'));
});

test('storage failures fall back to in-memory navigation defaults', () => {
  const unavailable = {
    getItem() { throw new Error('storage disabled'); },
    setItem() { throw new Error('storage disabled'); },
    removeItem() { throw new Error('storage disabled'); },
  };
  assert.equal(restoreSelectedSession(unavailable, 'machine'), null);
  assert.equal(restoreTerminalView(unavailable, 'machine', 'session'), 'chat');
  assert.doesNotThrow(() => persistSelectedSession(unavailable, 'machine', 'session'));
  assert.doesNotThrow(() => persistTerminalView(unavailable, 'machine', 'session', 'terminal'));
});
