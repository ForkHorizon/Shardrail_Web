import type { BrowserKeyRecord } from '@shardrail/client/browser';
import type { ApprovalResolutionRequest, CommandRequest, DaemonFrame } from '@shardrail/contracts';
import type { ApprovalBindingEcho, JournalEvent } from './session-model';
import { BrowserSessionController } from './browser-session-controller';
export { requestTerminalCommand } from './browser-session-controller';

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

export function createBrowserSession(options: BrowserSessionOptions): BrowserSession {
  const session = new BrowserSessionController(options);
  return session.start();
}


export function journalEvent(frame: Extract<DaemonFrame, { kind: 'durable_event' }>): JournalEvent | null {
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
