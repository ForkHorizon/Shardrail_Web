// Maps read-only daemon discovery responses into the existing session UI model.
import type { JournalEvent, SessionSummary } from './session-model';

export type DiscoveredSession = {
  session_id: string;
  agent_id: string;
  agent_name: string;
  title?: string | null;
  workdir?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  status: string;
  model?: string | null;
};

export function mergeDiscoveredSessions(managed: readonly SessionSummary[], discovered: readonly DiscoveredSession[]): SessionSummary[] {
  const sessions = new Map(managed.map((session) => [session.id, { ...session }]));
  for (const session of discovered) {
    const current = sessions.get(session.session_id);
    if (current) {
      current.label ||= session.title || session.session_id;
      current.agentKind ||= session.agent_id;
      if (!current.workdir && session.workdir != null) current.workdir = session.workdir;
      if (!current.model && session.model != null) current.model = session.model;
      continue;
    }
    sessions.set(session.session_id, {
      id: session.session_id,
      label: session.title || session.session_id,
      agentKind: session.agent_id,
      lifecycle: session.status === 'closed' ? 'closed' : 'open',
      status: session.status,
      lastActivityMs: session.updated_at_ms,
      lastCursor: 0,
      ...(session.workdir !== undefined ? { workdir: session.workdir } : {}),
      ...(session.model !== undefined ? { model: session.model } : {}),
      machineId: 'local',
    });
  }
  return [...sessions.values()].sort((a, b) => b.lastActivityMs - a.lastActivityMs || a.id.localeCompare(b.id));
}

export function historyJournalEvents(page: { session_id: string; turns: readonly { started_at_ms: number; items: readonly Record<string, unknown>[] }[] }): JournalEvent[] {
  let cursor = 0;
  return page.turns.flatMap((turn) => turn.items.map((item) => {
    const kind = typeof item.kind === 'string' ? item.kind : 'system_notice';
    let eventKind = kind;
    let payload: Record<string, unknown> = item;
    if (kind === 'message') {
      const role = item.role === 'user' ? 'user' : 'assistant';
      eventKind = role === 'user' ? 'user_message' : 'agent_message_chunk';
      payload = { ...item, role, content: { text: item.text } };
    }
    return { cursor: ++cursor, sessionId: page.session_id, kind: eventKind, occurredAtMs: turn.started_at_ms, payload };
  }));
}

export function liveSessionEvent(sessionId: string, event: Record<string, unknown>, cursor: number): JournalEvent {
  const kind = typeof event.event === 'string' ? event.event : 'system_notice';
  const item = event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : null;
  if (item) {
    const itemKind = typeof item.kind === 'string' ? item.kind : 'system_notice';
    const role = item.role === 'user' ? 'user' : 'assistant';
    return {
      cursor,
      sessionId,
      kind: itemKind === 'message' ? (role === 'user' ? 'user_message' : 'agent_message_chunk') : itemKind,
      occurredAtMs: Date.now(),
      payload: itemKind === 'message' ? { ...item, role, content: { text: item.text } } : item,
    };
  }
  const payload = { ...event };
  delete payload.event;
  return { cursor, sessionId, kind, occurredAtMs: Number(event.started_at_ms ?? event.completed_at_ms ?? Date.now()), payload };
}
