// Covers translation of provider live events into transcript rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import { liveSessionEvent } from '../src/discovered-session-model';

test('maps live provider items into the same transcript event format', () => {
  const event = liveSessionEvent('terminal-1', {
    event: 'item_appended',
    turn_id: 'turn-1',
    item: { kind: 'message', item_id: 'msg-1', role: 'assistant', text: 'live reply' },
  }, 4);
  assert.equal(event.kind, 'agent_message_chunk');
  assert.equal(event.cursor, 4);
  assert.equal(event.payload && typeof event.payload === 'object' && 'item_id' in event.payload ? event.payload.item_id : null, 'msg-1');
  assert.deepEqual((event.payload as { content?: { text?: string } }).content, { text: 'live reply' });
});
