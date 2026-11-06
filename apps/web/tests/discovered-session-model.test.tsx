// Covers discovered-session list merging and history presentation.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EntryArea } from '../src/screens/entry/EntryArea';
import { historyJournalEvents, mergeDiscoveredSessions } from '../src/discovered-session-model';

Object.assign(globalThis, { React });

test('renders discovered sessions with journal sessions and deduplicates shared IDs', () => {
  const sessions = mergeDiscoveredSessions([{
    id: 'shared', label: 'Managed title', agentKind: 'codex', lifecycle: 'open', status: 'active', lastActivityMs: 20, lastCursor: 3,
  }], [{
    session_id: 'shared', agent_id: 'codex', agent_name: 'Codex', title: 'Discovered title', created_at_ms: 1, updated_at_ms: 30, status: 'idle',
  }, {
    session_id: 'terminal-claude', agent_id: 'claude', agent_name: 'Claude Code', title: 'Terminal session', created_at_ms: 2, updated_at_ms: 10, status: 'idle',
  }]);
  const html = renderToStaticMarkup(createElement(EntryArea, {
    sessions, events: [], selectedId: null, workdirs: null, pickedWorkdir: '', createError: null,
    createPending: false, phase: 'connected', onSelect: () => {}, onPickWorkdir: () => {}, onCreateSession: () => {},
  }));
  assert.equal(sessions.length, 2);
  assert.match(html, /Terminal session/);
  assert.match(html, /terminal-claude/);
});

test('maps normalized history into the read-only transcript event format', () => {
  const events = historyJournalEvents({ session_id: 'terminal-1', turns: [{ started_at_ms: 99, items: [
    { kind: 'message', role: 'user', text: 'hello' },
    { kind: 'message', role: 'assistant', text: 'world' },
  ] }] });
  assert.deepEqual(events.map((event) => event.kind), ['user_message', 'agent_message_chunk']);
  assert.equal(events[1]?.occurredAtMs, 99);
});
