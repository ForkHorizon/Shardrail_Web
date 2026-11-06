// Owns browser connection and reconnect lifecycle outside the UI adapter.
import type { ApprovalBindingEcho, JournalEvent } from './session-model';
import type { BrowserSession, BrowserSessionOptions, ConnectionPhase, SessionSocket, StoredCursor } from './browser-session';
import { isKeyChangedError, journalEvent, reconnectDelayMs } from './browser-session';
import { applyDiscoveryFrame, setHistoryRequester } from './store';
import type { DaemonFrame } from '@shardrail/contracts';
import type { CommandRequest } from '@shardrail/contracts';

let sendTerminalCommand: ((request: CommandRequest) => boolean) | undefined;

export function requestTerminalCommand(kind: string, sessionId: string, values: Record<string, unknown> = {}) {
  return sendTerminalCommand?.({ command_id: crypto.randomUUID(), kind, payload: { session_id: sessionId, ...values }, expected_state: null, expected_turn_id: null }) ?? false;
}

export class BrowserSessionController {
  private generation = 0;
  private stopped = false;
  private attempt = 0;
  private phase: ConnectionPhase = 'connecting';
  private active: SessionSocket | undefined;
  private cursor: StoredCursor | undefined;
  private highWater: number;
  private seen = new Set<number>();
  private cancelTimer: (() => void) | undefined;

  constructor(private readonly options: BrowserSessionOptions) {
    this.cursor = options.loadCursor();
    this.highWater = this.cursor?.cursor ?? -1;
  }

  start(): BrowserSession {
    void this.open(false);
    return {
      reconnect: () => this.reconnect(),
      stop: () => this.stop(),
      setOnline: (online) => this.setOnline(online),
      resolveApproval: (approvalId, optionId, binding) => this.resolveApproval(approvalId, optionId, binding),
      request: (request) => this.request(request),
    };
  }

  private setPhase(next: ConnectionPhase) { this.phase = next; this.options.onStatus(next); }
  private clearTimer() { this.cancelTimer?.(); this.cancelTimer = undefined; }
  private remember(epoch: string) {
    const changed = this.cursor !== undefined && this.cursor.journalEpoch !== epoch;
    if (!this.cursor || changed) { this.seen.clear(); this.highWater = -1; }
    if (changed) this.cursor = undefined;
    this.options.onEpoch(epoch);
  }

  private async open(retrying: boolean) {
    if (this.stopped) return;
    this.clearTimer();
    const token = ++this.generation;
    const previous = this.active;
    this.active = undefined;
    previous?.close();
    if (!this.options.online()) { this.setPhase('offline'); return; }
    this.setPhase(retrying ? 'reconnecting' : 'connecting');
    try {
      const saved = this.cursor;
      const client = await this.options.connect({ url: this.options.url, identity: this.options.identity, ...(saved ? { cursor: saved.cursor, journalEpoch: saved.journalEpoch } : {}) });
      if (this.stopped || token !== this.generation) { client.close(); return; }
      this.remember(client.host.journal_epoch);
      this.active = client;
      sendTerminalCommand = (request) => {
        if (this.stopped || this.phase !== 'connected' || this.active !== client) return false;
        try { client.request(request); return true; } catch { return false; }
      };
      this.attempt = 0;
      setHistoryRequester((sessionId) => {
        if (this.active !== client || this.phase !== 'connected') return;
        client.request({ command_id: crypto.randomUUID(), kind: 'session.history', payload: { session_id: sessionId, limit: 100, direction: 'backward' }, expected_state: null, expected_turn_id: null });
      });
      client.onFrame((frame) => this.onFrame(frame, token, client));
      client.onError((error) => this.onError(error, token));
      this.setPhase('connected');
      client.request({ command_id: crypto.randomUUID(), kind: 'session.list', payload: {}, expected_state: null, expected_turn_id: null });
    } catch (error) {
      if (this.stopped || token !== this.generation) return;
      setHistoryRequester(undefined); sendTerminalCommand = undefined;
      if (isKeyChangedError(error)) this.setPhase('key-changed'); else this.scheduleRetry();
    }
  }

  private onFrame(frame: DaemonFrame, token: number, client: SessionSocket) {
    if (this.stopped || token !== this.generation) return;
    if (frame.kind !== 'durable_event') {
      const control = frame as unknown as { kind: string };
      if (control.kind === 'session_list' || control.kind === 'session_history') applyDiscoveryFrame(control as Parameters<typeof applyDiscoveryFrame>[0]);
      if (control.kind === 'terminal_output' || control.kind === 'terminal_exited') window.dispatchEvent(new CustomEvent('shardrail-terminal', { detail: frame }));
      this.options.onControl(frame);
      return;
    }
    const event = journalEvent(frame);
    if (!event || this.seen.has(event.cursor)) return;
    this.seen.add(event.cursor);
    if (event.cursor > this.highWater) {
      this.highWater = event.cursor;
      this.cursor = { cursor: this.highWater, journalEpoch: client.host.journal_epoch };
      this.options.saveCursor(this.highWater, client.host.journal_epoch);
    }
    this.options.onDurableEvent(event);
  }

  private onError(error: Error, token: number) {
    if (this.stopped || token !== this.generation) return;
    this.generation += 1; this.active = undefined;
    setHistoryRequester(undefined); sendTerminalCommand = undefined;
    if (isKeyChangedError(error)) this.setPhase('key-changed'); else this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.stopped || this.phase === 'key-changed') return;
    if (!this.options.online()) { this.setPhase('offline'); return; }
    this.attempt += 1; this.setPhase('reconnecting');
    this.cancelTimer = this.options.schedule(reconnectDelayMs(this.attempt), () => { void this.open(true); });
  }

  private reconnect() {
    if (this.stopped) return;
    this.attempt = 0; this.clearTimer();
    void this.open(this.phase === 'connected' || this.phase === 'reconnecting' || this.phase === 'offline');
  }

  private stop() {
    this.stopped = true; this.clearTimer(); this.generation += 1;
    setHistoryRequester(undefined); sendTerminalCommand = undefined;
    const previous = this.active; this.active = undefined; previous?.close();
  }

  private setOnline(online: boolean) {
    if (this.stopped || this.phase === 'key-changed') return;
    if (!online) {
      this.clearTimer(); this.generation += 1;
      setHistoryRequester(undefined); sendTerminalCommand = undefined;
      const previous = this.active; this.active = undefined; previous?.close(); this.setPhase('offline');
    } else if (this.phase === 'offline') void this.open(true);
  }

  private resolveApproval(approvalId: string, optionId: string, binding: ApprovalBindingEcho | null): 'sent' | 'blocked' {
    if (this.stopped || this.phase !== 'connected' || !this.active || !approvalId || !optionId || !binding) return 'blocked';
    if (!binding.sessionId || !binding.turnId || !binding.providerRequestId || !/^[0-9a-fA-F]{64}$/.test(binding.contentHash)) return 'blocked';
    try { this.active.resolveApproval({ approval_id: approvalId, option_id: optionId, content_hash: binding.contentHash, session_id: binding.sessionId, turn_id: binding.turnId, provider_request_id: binding.providerRequestId }); return 'sent'; } catch { return 'blocked'; }
  }

  private request(request: CommandRequest): 'sent' | 'blocked' {
    if (this.stopped || this.phase !== 'connected' || !this.active) return 'blocked';
    try { this.active.request(request); return 'sent'; } catch { return 'blocked'; }
  }
}
