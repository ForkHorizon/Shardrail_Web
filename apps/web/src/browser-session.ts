import type { BrowserKeyRecord } from '@shardrail/client/browser';
import type { ApprovalResolutionRequest, CommandRequest, DaemonFrame } from '@shardrail/contracts';
import type { ApprovalBindingEcho, JournalEvent } from './session-model';
import { applyDiscoveryFrame, setHistoryRequester } from './store';

export type ConnectionPhase = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'key-changed';

export type StoredCursor = { cursor: number; journalEpoch: string };

export interface SessionSocket {
  host: { journal_epoch: string };
  onFrame(listener: (frame: DaemonFrame) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  resolveApproval(request: ApprovalResolutionRequest): void;
  request(request: CommandRequest): void;
  close(): void;
}

export interface BrowserSessionOptions {
  connect(options: { url: string; identity: BrowserKeyRecord; cursor?: number; journalEpoch?: string }): Promise<SessionSocket>;
  url: string;
  identity: BrowserKeyRecord;
  loadCursor(): StoredCursor | undefined;
  saveCursor(cursor: number, journalEpoch: string): void;
  schedule(delayMs: number, run: () => void): () => void;
  online(): boolean;
  onStatus(phase: ConnectionPhase): void;
  onDurableEvent(event: JournalEvent): void;
  onControl(frame: Exclude<DaemonFrame, { kind: 'durable_event' }>): void;
  onEpoch(epoch: string): void;
}

export interface BrowserSession {
  reconnect(): void;
  stop(): void;
  setOnline(online: boolean): void;
  resolveApproval(approvalId: string, optionId: string, binding: ApprovalBindingEcho | null): 'sent' | 'blocked';
  request(request: CommandRequest): 'sent' | 'blocked';
}

export function reconnectDelayMs(attempt: number) {
  if (!Number.isSafeInteger(attempt) || attempt < 1) return 200;
  return Math.min(8_000, 200 * 2 ** Math.min(attempt - 1, 6));
}

export function connectionStatusLabel(phase: ConnectionPhase) {
  switch (phase) {
    case 'connecting': return 'Connecting · browser WebSocket';
    case 'connected': return 'Connected · browser WebSocket';
    case 'reconnecting': return 'Reconnecting · browser WebSocket';
    case 'offline': return 'Offline · browser WebSocket';
    case 'key-changed': return 'Key changed · pairing is blocked';
  }
}

export function isKeyChangedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /key changed|pairing is blocked/i.test(message);
}

export function parseStoredCursor(raw: string | null): StoredCursor | undefined {
  if (!raw) return undefined;
  try {
    const saved = JSON.parse(raw) as { cursor?: unknown; journalEpoch?: unknown };
    if (saved && Number.isSafeInteger(saved.cursor) && (saved.cursor as number) >= 0 && typeof saved.journalEpoch === 'string' && saved.journalEpoch.length > 0) {
      return { cursor: saved.cursor as number, journalEpoch: saved.journalEpoch };
    }
  } catch { /* Ignore corrupt cursor state and replay from the beginning. */ }
  return undefined;
}

export function sessionWorkdirs(frame: DaemonFrame): readonly string[] | null {
  return frame.kind === 'session_workdirs' ? frame.workdirs : null;
}

export function sessionCreateError(frame: DaemonFrame, pendingCommandId: string | null): string | null {
  if (frame.kind !== 'command_rejected' || pendingCommandId === null || frame.command_id !== pendingCommandId) return null;
  return frame.error;
}

export interface CreateFlight {
  pendingCommandId: string | null;
  acceptedCommandId: string | null;
}

export interface CreateFlightResult {
  flight: CreateFlight;
  selectSessionId: string | null;
  /** Undefined leaves the current create error unchanged. */
  createError: string | null | undefined;
  dismissSelection: boolean;
}

const idleCreateFlight: CreateFlightResult = {
  flight: { pendingCommandId: null, acceptedCommandId: null },
  selectSessionId: null,
  createError: undefined,
  dismissSelection: false,
};

export function noteCreateSent(commandId: string): CreateFlight {
  return { pendingCommandId: commandId, acceptedCommandId: null };
}

export function createFlightOnSessionCreated(flight: CreateFlight, commandId: string | null, sessionId: string): CreateFlightResult {
  const matches = commandId !== null && (commandId === flight.pendingCommandId || commandId === flight.acceptedCommandId);
  if (!matches) return { ...idleCreateFlight, flight };
  return { flight, selectSessionId: sessionId, createError: undefined, dismissSelection: false };
}

export function createFlightOnControl(flight: CreateFlight, frame: DaemonFrame): CreateFlightResult {
  if (frame.kind === 'command_accepted' && frame.command_id === flight.pendingCommandId) {
    return {
      flight: { pendingCommandId: null, acceptedCommandId: frame.command_id },
      selectSessionId: null,
      createError: undefined,
      dismissSelection: false,
    };
  }
  const error = sessionCreateError(frame, flight.pendingCommandId);
  if (error === null) return { ...idleCreateFlight, flight };
  return {
    flight: { pendingCommandId: null, acceptedCommandId: null },
    selectSessionId: null,
    createError: error,
    dismissSelection: true,
  };
}

export function cursorStorageKey(hostPublicKey: string) {
  return `shardrail-browser-cursor:${hostPublicKey}`;
}

type SessionRuntime = {
  generation: number;
  stopped: boolean;
  attempt: number;
  phase: ConnectionPhase;
  active: SessionSocket | undefined;
  cursor: StoredCursor | undefined;
  highWater: number;
  seen: Set<number>;
  cancelTimer: (() => void) | undefined;
};

function setPhase(options: BrowserSessionOptions, state: SessionRuntime, phase: ConnectionPhase) {
  state.phase = phase;
  options.onStatus(phase);
}

function clearTimer(state: SessionRuntime) {
  state.cancelTimer?.();
  state.cancelTimer = undefined;
}

function remember(options: BrowserSessionOptions, state: SessionRuntime, epoch: string) {
  const changed = state.cursor !== undefined && state.cursor.journalEpoch !== epoch;
  if (!state.cursor || changed) { state.seen.clear(); state.highWater = -1; }
  if (changed) state.cursor = undefined;
  options.onEpoch(epoch);
}

function scheduleRetry(options: BrowserSessionOptions, state: SessionRuntime) {
  if (state.stopped || state.phase === 'key-changed') return;
  if (!options.online()) { setPhase(options, state, 'offline'); return; }
  state.attempt += 1;
  setPhase(options, state, 'reconnecting');
  state.cancelTimer = options.schedule(reconnectDelayMs(state.attempt), () => { void openConnection(options, state, true); });
}

function handleFrame(options: BrowserSessionOptions, state: SessionRuntime, client: SessionSocket, token: number, frame: DaemonFrame) {
  if (state.stopped || token !== state.generation) return;
  if (frame.kind !== 'durable_event') {
    const discoveryFrame = frame as unknown as { kind: string };
    if (discoveryFrame.kind === 'session_list' || discoveryFrame.kind === 'session_history') applyDiscoveryFrame(discoveryFrame as Parameters<typeof applyDiscoveryFrame>[0]);
    options.onControl(frame);
    return;
  }
  const event = journalEvent(frame);
  if (!event || state.seen.has(event.cursor)) return;
  state.seen.add(event.cursor);
  if (event.cursor > state.highWater) {
    state.highWater = event.cursor;
    state.cursor = { cursor: state.highWater, journalEpoch: client.host.journal_epoch };
    options.saveCursor(state.highWater, client.host.journal_epoch);
  }
  options.onDurableEvent(event);
}

async function openConnection(options: BrowserSessionOptions, state: SessionRuntime, retrying: boolean) {
  if (state.stopped) return;
  clearTimer(state);
  const token = ++state.generation;
  state.active?.close();
  state.active = undefined;
  if (!options.online()) { setPhase(options, state, 'offline'); return; }
  setPhase(options, state, retrying ? 'reconnecting' : 'connecting');
  try {
    const client = await options.connect({ url: options.url, identity: options.identity, ...(state.cursor ? { cursor: state.cursor.cursor, journalEpoch: state.cursor.journalEpoch } : {}) });
    if (state.stopped || token !== state.generation) { client.close(); return; }
    remember(options, state, client.host.journal_epoch);
    state.active = client;
    state.attempt = 0;
    setHistoryRequester((sessionId) => {
      if (state.active === client && state.phase === 'connected') client.request({ command_id: crypto.randomUUID(), kind: 'session.history', payload: { session_id: sessionId, limit: 100, direction: 'backward' }, expected_state: null, expected_turn_id: null });
    });
    client.onFrame((frame) => handleFrame(options, state, client, token, frame));
    setPhase(options, state, 'connected');
    client.request({ command_id: crypto.randomUUID(), kind: 'session.list', payload: {}, expected_state: null, expected_turn_id: null });
    client.onError((error) => handleConnectionError(options, state, token, error));
  } catch (error) {
    handleConnectionError(options, state, token, error instanceof Error ? error : new Error(String(error)));
  }
}

function handleConnectionError(options: BrowserSessionOptions, state: SessionRuntime, token: number, error: Error) {
  if (state.stopped || token !== state.generation) return;
  state.generation += 1;
  state.active = undefined;
  setHistoryRequester(undefined);
  if (isKeyChangedError(error)) { setPhase(options, state, 'key-changed'); return; }
  scheduleRetry(options, state);
}

function resolveApproval(state: SessionRuntime, approvalId: string, optionId: string, binding: ApprovalBindingEcho | null): 'sent' | 'blocked' {
  if (state.stopped || state.phase !== 'connected' || !state.active || !approvalId || !optionId || !binding) return 'blocked';
  if (!binding.sessionId || !binding.turnId || !binding.providerRequestId || !/^[0-9a-fA-F]{64}$/.test(binding.contentHash)) return 'blocked';
  try {
    state.active.resolveApproval({ approval_id: approvalId, option_id: optionId, content_hash: binding.contentHash, session_id: binding.sessionId, turn_id: binding.turnId, provider_request_id: binding.providerRequestId });
    return 'sent';
  } catch { return 'blocked'; }
}

export function createBrowserSession(options: BrowserSessionOptions): BrowserSession {
  const cursor = options.loadCursor();
  const state: SessionRuntime = { generation: 0, stopped: false, attempt: 0, phase: 'connecting', active: undefined, cursor, highWater: cursor?.cursor ?? -1, seen: new Set(), cancelTimer: undefined };
  void openConnection(options, state, false);
  return {
    reconnect() {
      if (state.stopped) return;
      state.attempt = 0;
      clearTimer(state);
      void openConnection(options, state, ['connected', 'reconnecting', 'offline'].includes(state.phase));
    },
    stop() {
      state.stopped = true;
      setHistoryRequester(undefined);
      clearTimer(state);
      state.generation += 1;
      state.active?.close();
      state.active = undefined;
    },
    setOnline(online) {
      if (state.stopped || state.phase === 'key-changed') return;
      if (!online) {
        clearTimer(state);
        state.generation += 1;
        state.active?.close();
        state.active = undefined;
        setHistoryRequester(undefined);
        setPhase(options, state, 'offline');
      } else if (state.phase === 'offline') void openConnection(options, state, true);
    },
    resolveApproval: (approvalId, optionId, binding) => resolveApproval(state, approvalId, optionId, binding),
    request(request) {
      if (state.stopped || state.phase !== 'connected' || !state.active) return 'blocked';
      try { state.active.request(request); return 'sent'; } catch { return 'blocked'; }
    },
  };
}

function journalEvent(frame: Extract<DaemonFrame, { kind: 'durable_event' }>): JournalEvent | null {
  const cursor = frame.cursor;
  const sessionId = frame.event.session_id;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || typeof sessionId !== 'string' || sessionId.length === 0) return null;
  return {
    cursor,
    sessionId,
    kind: frame.event.kind,
    occurredAtMs: typeof frame.event.occurred_at_ms === 'number' ? frame.event.occurred_at_ms : 0,
    payload: frame.event.payload,
  };
}
