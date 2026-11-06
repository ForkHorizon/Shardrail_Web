// Browser session creation and journal/control event handling.
import { useEffect } from 'react';
import { applyDaemonEvent, observeJournalEpoch } from './store';
import { activeMachineId, defaultRelayUrl, browserWebSocketUrl } from './browser-pairing';
import { connectBrowser, connectBrowserRelay, openBrowserKeyStore } from '@shardrail/client/browser';
import { createBrowserSession, createFlightOnControl, createFlightOnSessionCreated, isKeyChangedError, sessionWorkdirs, type CreateFlightResult } from './browser-session';
import { approvalIdFromPayload, clearPromptOnAccept, controlFailureTarget } from './session-model';
import type { AppState } from './app-state';

function applyCreateFlight(state: AppState, result: CreateFlightResult) {
  state.createFlightRef.current = result.flight;
  state.setCreatePending(result.selectSessionId === null && (result.flight.pendingCommandId !== null || result.flight.acceptedCommandId !== null));
  if (result.selectSessionId) {
    state.selectedCreateRef.current = result.selectSessionId;
    state.setCreatedSessionId(result.selectSessionId);
  }
  if (result.createError !== undefined) state.setCreateError(result.createError);
  if (result.dismissSelection) {
    state.setDismissedSessionId(state.selectedCreateRef.current);
    state.selectedCreateRef.current = null;
    state.setCreatedSessionId(null);
  }
}

function createSessionHandlers(state: AppState) {
  return {
    onEpoch: (epoch: string) => observeJournalEpoch(epoch),
    onStatus: (phase: typeof state.connectionPhase) => {
      state.setConnectionPhase(phase);
      if (phase !== 'connected') state.publishApprovalFlight({ type: 'disconnect' });
    },
    onDurableEvent: (event: { cursor: number; sessionId: string; kind: string; payload: unknown; occurredAtMs: number }) => {
      applyDaemonEvent(event.cursor, { session_id: event.sessionId, kind: event.kind, payload: event.payload, occurred_at_ms: event.occurredAtMs }, null);
      state.publishApprovalFlight({ type: 'journal', kind: event.kind, approvalId: approvalIdFromPayload(event.payload) });
      if (event.kind !== 'session_created') return;
      const commandId = event.payload && typeof event.payload === 'object' && 'command_id' in event.payload ? (event.payload as { command_id?: unknown }).command_id : null;
      applyCreateFlight(state, createFlightOnSessionCreated(state.createFlightRef.current, typeof commandId === 'string' ? commandId : null, event.sessionId));
    },
    onControl: (frame: Parameters<typeof createFlightOnControl>[1]) => {
      const workdirs = sessionWorkdirs(frame);
      if (workdirs) { state.setSessionWorkdirs(workdirs); return; }
      const reduced = createFlightOnControl(state.createFlightRef.current, frame);
      applyCreateFlight(state, reduced);
      if (reduced.createError !== undefined) return;
      if (frame.kind === 'approval_resolved') state.publishApprovalFlight({ type: 'resolved', approvalId: frame.approval_id });
      if (frame.kind === 'command_accepted') {
        const pending = state.pendingPromptRef.current;
        if (clearPromptOnAccept(pending?.commandId ?? null, frame.command_id) && pending) {
          state.setPromptClear(pending);
          state.pendingPromptRef.current = null;
        }
        state.setPromptError(null);
      }
      const failure = controlFailureTarget(frame.kind, state.approvalFlightRef.current.inFlight.size);
      if (failure === 'approval') state.publishApprovalFlight({ type: 'rejected' });
      if (failure === 'prompt' && (frame.kind === 'error' || frame.kind === 'command_rejected')) {
        if (frame.kind === 'command_rejected' && state.pendingPromptRef.current?.commandId === frame.command_id) state.pendingPromptRef.current = null;
        state.setPromptError(frame.error);
      }
    },
  };
}

export function useBrowserSessionEffect(state: AppState) {
  useEffect(() => {
    if (!state.browserMain || !state.ready || state.pairing.kind !== 'paired') return;
    const info = state.pairing.info;
    const holder: { current: ReturnType<typeof createBrowserSession> | null } = { current: null };
    let cancelled = false;
    void (async () => {
      try {
        const identity = await (await openBrowserKeyStore()).get(info.daemonPublicKey);
        if (cancelled) return;
        if (!identity || !info.clientId) throw new Error('browser key is missing; pair this browser again');
        const relayUrl = state.isRelay ? defaultRelayUrl() : state.query.get('relay');
        const machineId = state.isRelay ? (state.currentMachineId ?? activeMachineId()) : state.query.get('machine');
        const session = createBrowserSession({
          connect: relayUrl && machineId ? (opts) => connectBrowserRelay({ relayUrl, machineId, identity: opts.identity, cursor: opts.cursor, journalEpoch: opts.journalEpoch }) : connectBrowser,
          url: browserWebSocketUrl(), identity, loadCursor: () => undefined, saveCursor: () => undefined,
          schedule: (delayMs, run) => { const id = window.setTimeout(run, delayMs); return () => window.clearTimeout(id); },
          online: () => navigator.onLine,
          ...createSessionHandlers(state),
        });
        if (cancelled) { session.stop(); return; }
        holder.current = session;
        state.browserSession.current = session;
      } catch (error) {
        if (!cancelled) state.setConnectionPhase(isKeyChangedError(error) ? 'key-changed' : 'reconnecting');
      }
    })();
    const onOnline = () => holder.current?.setOnline(navigator.onLine);
    const onOffline = () => holder.current?.setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      cancelled = true;
      holder.current?.stop();
      if (state.browserSession.current === holder.current) state.browserSession.current = null;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [state.ready, state.pairing, state.reconnect]);
}
