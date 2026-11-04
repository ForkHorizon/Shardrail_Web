// Automated unit tests verifying ANSI escape parsing and terminal view rendering.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAnsiSpans } from '../src/screens/session/ansi-sanitizer';

test('parseAnsiSpans parses plain text without escapes', () => {
  const spans = parseAnsiSpans('Hello world');
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.text, 'Hello world');
  assert.equal(spans[0]?.classes, '');
});

test('parseAnsiSpans handles foreground colors and bold style', () => {
  const input = '\x1b[31mRed\x1b[0m \x1b[1;32mBold Green\x1b[0m';
  const spans = parseAnsiSpans(input);
  assert.equal(spans.length, 3);
  assert.equal(spans[0]?.text, 'Red');
  assert.match(spans[0]?.classes ?? '', /ansi-fg-red/);
  assert.equal(spans[1]?.text, ' ');
  assert.equal(spans[2]?.text, 'Bold Green');
  assert.match(spans[2]?.classes ?? '', /ansi-bold/);
  assert.match(spans[2]?.classes ?? '', /ansi-fg-green/);
});

test('parseAnsiSpans handles background colors and bright variants', () => {
  const input = '\x1b[44;93mYellow on Blue\x1b[0m';
  const spans = parseAnsiSpans(input);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.text, 'Yellow on Blue');
  assert.match(spans[0]?.classes ?? '', /ansi-bg-blue/);
  assert.match(spans[0]?.classes ?? '', /ansi-fg-bright-yellow/);
});

test('parseAnsiSpans strips non-color CSI escapes and control characters', () => {
  const input = '\x07\x08\x1b[2K\x1b[1;1HClean Line\x1b[0m';
  const spans = parseAnsiSpans(input);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.text, 'Clean Line');
});

test('parseAnsiSpans preserves multiple lines with line breaks', () => {
  const input = 'Line 1\r\nLine 2\nLine 3';
  const spans = parseAnsiSpans(input);
  const fullText = spans.map((s) => s.text).join('');
  assert.equal(fullText, 'Line 1\r\nLine 2\nLine 3');
});
