// Verifies the relay machine selector with multiple discovered machines.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HierarchyNav } from '../src/ui/HierarchyNav';

Object.assign(globalThis, { React });

test('HierarchyNav shows both relay machines and their availability', () => {
  const html = renderToStaticMarkup(createElement(HierarchyNav, {
    machines: [
      { id: 'machine-a', name: 'Machine machine-a', isOnline: true },
      { id: 'machine-b', name: 'Machine machine-b', isOnline: false },
    ],
    selectedMachineId: 'machine-a',
    onSelectMachine: () => {},
    agents: [],
    selectedAgent: null,
    onSelectAgent: () => {},
    selectedSessionId: null,
  }));

  assert.match(html, /Machine machine-a/);
  assert.match(html, /Machine machine-b/);
  assert.match(html, /online/);
  assert.match(html, /offline/);
  assert.match(html, /disabled/);
});
