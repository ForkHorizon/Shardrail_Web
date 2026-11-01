import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeDiffView } from '../src/ui/SafeDiffView';
import { SafeCommandView } from '../src/ui/SafeCommandView';
import { SafeReasoningView } from '../src/ui/SafeReasoningView';
import { SafeToolView } from '../src/ui/SafeToolView';
import { HierarchyNav } from '../src/ui/HierarchyNav';
import { SessionFilterBar } from '../src/ui/SessionFilterBar';
import { transcriptItems, sessionSummaries, type JournalEvent } from '../src/session-model';

Object.assign(globalThis, { React });

test('SafeDiffView parses unified diff and renders lines with line numbers safely', () => {
  const sampleDiff = [
    '--- a/src/main.rs',
    '+++ b/src/main.rs',
    '@@ -1,4 +1,5 @@',
    ' fn main() {',
    '-    println!("old");',
    '+    println!("new");',
    '+    println!("safe");',
    ' }',
  ].join('\n');

  const html = renderToStaticMarkup(createElement(SafeDiffView, {
    path: 'src/main.rs',
    action: 'modified',
    diff: sampleDiff,
  }));

  assert.match(html, /src\/main\.rs/);
  assert.match(html, /diff-line-add/);
  assert.match(html, /diff-line-del/);
  assert.match(html, /diff-line-hunk/);
  assert.match(html, /println!\(&quot;new&quot;\);/);
  assert.match(html, /println!\(&quot;old&quot;\);/);
  assert.match(html, /aria-label="Diff for src\/main\.rs"/);
  // Must not contain unescaped script tags
  assert.doesNotMatch(html, /<script>/);
});

test('SafeCommandView renders command, cwd, exit code, and stdout/stderr safely', () => {
  const html = renderToStaticMarkup(createElement(SafeCommandView, {
    command: 'cargo test --workspace',
    cwd: '/Users/test/project',
    exitCode: 0,
    stdout: 'test result: ok. 14 passed; 0 failed',
    stderr: '',
    status: 'completed',
  }));

  assert.match(html, /cargo test --workspace/);
  assert.match(html, /\/Users\/test\/project/);
  assert.match(html, /exit 0/i);
  assert.match(html, /test result: ok/);
  assert.match(html, /untrusted command output/i);
  assert.doesNotMatch(html, /<script>/);
});

test('SafeReasoningView renders model thought process with duration and untrusted tag', () => {
  const html = renderToStaticMarkup(createElement(SafeReasoningView, {
    summary: 'Analyze SQLite index schema',
    content: 'Inspecting thread_history_1.sqlite tables to verify indices.',
    durationMs: 1420,
    defaultExpanded: true,
  }));

  assert.match(html, /Analyze SQLite index schema/);
  assert.match(html, /1\.4s/);
  assert.match(html, /Inspecting thread_history_1\.sqlite tables/);
  assert.match(html, /untrusted internal thought/i);
});

test('SafeToolView renders tool name, callId, formatted args and output safely', () => {
  const html = renderToStaticMarkup(createElement(SafeToolView, {
    toolName: 'read_file',
    callId: 'call_12345',
    arguments: { path: '/tmp/test.txt', limit: 50 },
    output: 'line 1\nline 2',
    isError: false,
    status: 'completed',
    defaultExpanded: true,
  }));

  assert.match(html, /read_file/);
  assert.match(html, /call_12345/);
  assert.match(html, /&quot;path&quot;: &quot;\/tmp\/test\.txt&quot;/);
  assert.match(html, /line 1/);
  assert.match(html, /untrusted tool payload/i);
});

test('HierarchyNav renders Machines -> Agents -> Sessions breadcrumb and selector pills', () => {
  const machines = [
    { id: 'm1', name: 'Workstation Mac', isOnline: true, sessionCount: 5 },
    { id: 'm2', name: 'Linux Server', isOnline: false, sessionCount: 2 },
  ];
  const agents = [
    { name: 'codex', label: 'Codex', sessionCount: 4 },
    { name: 'claude_code', label: 'Claude Code', sessionCount: 3 },
  ];

  const html = renderToStaticMarkup(createElement(HierarchyNav, {
    machines,
    selectedMachineId: 'm1',
    onSelectMachine: () => {},
    agents,
    selectedAgent: 'codex',
    onSelectAgent: () => {},
    selectedSessionId: 'sess-abc-123',
    onClearSession: () => {},
  }));

  assert.match(html, /Workstation Mac/);
  assert.match(html, /Codex/);
  assert.match(html, /sess-abc-123/);
  assert.match(html, /aria-label="Hierarchy navigation"/);
  assert.match(html, /aria-label="Breadcrumb"/);
});

test('SessionFilterBar renders search field, status filter pills, and sort controls', () => {
  const html = renderToStaticMarkup(createElement(SessionFilterBar, {
    searchQuery: 'backend',
    onSearchChange: () => {},
    statusFilter: 'open',
    onStatusFilterChange: () => {},
    sortBy: 'newest',
    onSortChange: () => {},
    onResetFilters: () => {},
    totalCount: 10,
    filteredCount: 3,
  }));

  assert.match(html, /value="backend"/);
  assert.match(html, /Active/);
  assert.match(html, /Newest/);
  assert.match(html, /3 of 10/);
});

test('transcriptItems maps Codex file diffs, command executions, and reasoning into safe presentation', () => {
  const events: JournalEvent[] = [
    {
      cursor: 1,
      sessionId: 's1',
      occurredAtMs: 1700000000000,
      kind: 'session_created',
      payload: {
        agent_kind: 'codex',
        workdir: '/repo',
        model: 'gpt-4o',
      },
    },
    {
      cursor: 2,
      sessionId: 's1',
      occurredAtMs: 1700000001000,
      kind: 'agent_activity_chunk',
      payload: {
        summary: 'Command: cargo check',
        item_type: 'commandExecution',
        command: 'cargo check',
        cwd: '/repo',
        exit_code: 0,
        stdout: 'Finished dev [unoptimized + debuginfo] target(s)',
        status: 'completed',
      },
    },
    {
      cursor: 3,
      sessionId: 's1',
      occurredAtMs: 1700000002000,
      kind: 'agent_activity_chunk',
      payload: {
        summary: 'File change: Cargo.toml',
        item_type: 'fileChange',
        path: 'Cargo.toml',
        action: 'modified',
        diff: '--- a/Cargo.toml\n+++ b/Cargo.toml\n@@ -1 +1,2 @@\n+zstd = "0.13"',
      },
    },
    {
      cursor: 4,
      sessionId: 's1',
      occurredAtMs: 1700000003000,
      kind: 'agent_activity_chunk',
      payload: {
        summary: 'Reasoning about architecture',
        item_type: 'reasoning',
        content: 'Evaluating streaming response format.',
        duration_ms: 850,
      },
    },
  ];

  const summaries = sessionSummaries(events);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].agentKind, 'codex');
  assert.equal(summaries[0].workdir, '/repo');
  assert.equal(summaries[0].model, 'gpt-4o');

  const items = transcriptItems(events);
  assert.equal(items.length, 4);

  // Initial event is session_created
  assert.equal(items[0].kind, 'session_created');

  // Command presentation
  assert.equal(items[1].presentation, 'command');
  assert.ok(items[1].commandData);
  assert.equal(items[1].commandData?.command, 'cargo check');
  assert.equal(items[1].commandData?.exitCode, 0);

  // Diff presentation
  assert.equal(items[2].presentation, 'diff');
  assert.ok(items[2].diffData);
  assert.equal(items[2].diffData?.path, 'Cargo.toml');
  assert.match(items[2].diffData?.diff ?? '', /zstd = "0\.13"/);

  // Reasoning presentation
  assert.equal(items[3].presentation, 'reasoning');
  assert.ok(items[3].reasoningData);
  assert.equal(items[3].reasoningData?.content, 'Evaluating streaming response format.');
  assert.equal(items[3].reasoningData?.durationMs, 850);
});
