// Browser and desktop daemon transport effects.
import { useCallback, useEffect } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { applyDaemonEvent, isLiveTail, rowCount, setDaemonAgentChunkCount, setDaemonClockMapping, setDaemonTotal, setDaemonWindow } from './store';
import { connectBrowser, connectBrowserRelay, openBrowserKeyStore } from '@shardrail/client/browser';
import { activeMachineId, browserWebSocketUrl } from './browser-pairing';
import { stateFromInfo } from './pairing';
import { coalesceChannelFrame, liveTailWindowSize, rangeForWindow } from './streaming-view';
import { b4Trace } from './run-context';
import type { AppStateBase } from './app-state';

export function useRequestRange(state: AppStateBase) {
  return useCallback((start: number, limit: number, noticeVersion?: number) => {
    if (!state.autobench) return;
    const request = state.rangeRequest.current;
    if (request.inFlight) {
      const version = noticeVersion ?? request.pending?.noticeVersion;
      request.pending = version === undefined ? { start, limit } : { start, limit, noticeVersion: version };
      return;
    }
    const issue = (requestedStart: number, requestedLimit: number, version?: number) => {
      const total = rowCount();
      const window = rangeForWindow(total, requestedStart, Math.max(32, requestedLimit), isLiveTail());
      const key = `${window.start}:${window.limit}:${total}`;
      if (request.key === key) return;
      request.key = key;
      request.inFlight = true;
      const id = ++request.id;
      void invoke<{ start: number; total: number; version: number; agentChunkCount: number; rows: { cursor: number; event: { session_id: string; kind: string; payload: unknown }; receipt_wall_clock_ms?: number | null }[] }>('get_stream_window', { start: window.start, limit: window.limit }).then((view) => {
        setDaemonAgentChunkCount(view.agentChunkCount);
        if (id === request.id && !request.pending) setDaemonWindow(view.start, view.total, view.rows, view.version);
        else setDaemonTotal(view.total, false);
        return version === undefined ? undefined : invoke('acknowledge_stream_view', { version });
      }).catch((error: unknown) => { state.setTransportStatus(`Stream view failed: ${String(error)}`); b4Trace('window request failed', { error: String(error), start: window.start, limit: window.limit }); }).finally(() => {
        request.inFlight = false;
        const next = request.pending;
        delete request.pending;
        if (next) { request.key = ''; issue(next.start, next.limit, next.noticeVersion); }
      });
    };
    issue(start, limit, noticeVersion);
  }, [state.autobench]);
}

export function useBrowserTransportEffect(state: AppStateBase) {
  useEffect(() => {
    if (!state.ready || (state.b4Enabled && (!state.autobench || !state.query.has('b4'))) || (!state.b4Enabled && state.pairing.kind !== 'paired') || state.browserMain || !state.browserMode) return;
    let client: Awaited<ReturnType<typeof connectBrowser>> | undefined;
    let disposed = false;
    void (async () => {
      try {
        const info = await state.pairingApi.inspect();
        const identity = await (await openBrowserKeyStore()).get(info.daemonPublicKey);
        if (!identity || !info.clientId) throw new Error('browser key is missing; pair this browser again');
        const cursorKey = `shardrail-browser-cursor:${info.daemonPublicKey}`;
        let cursor: number | undefined;
        let journalEpoch: string | undefined;
        try {
          const saved = JSON.parse(localStorage.getItem(cursorKey) ?? 'null') as { cursor?: unknown; journalEpoch?: unknown } | null;
          if (saved && Number.isSafeInteger(saved.cursor) && typeof saved.journalEpoch === 'string') { cursor = saved.cursor as number; journalEpoch = saved.journalEpoch; }
        } catch { /* Ignore corrupt cursor state and replay from the beginning. */ }
        const relay = state.query.get('relay'), machine = state.query.get('machine');
        client = relay && machine ? await connectBrowserRelay({ relayUrl: relay, machineId: machine, identity, cursor, journalEpoch }) : await connectBrowser({ url: browserWebSocketUrl(), identity, cursor, journalEpoch });
        if (disposed) { client.close(); return; }
        client.onFrame((frame) => { if (frame.kind === 'durable_event') { applyDaemonEvent(frame.cursor, { session_id: frame.event.session_id, kind: frame.event.kind, payload: frame.event.payload }, frame.receipt_wall_clock_ms); try { localStorage.setItem(cursorKey, JSON.stringify({ cursor: frame.cursor, journalEpoch: client?.host.journal_epoch ?? '' })); } catch (error) { console.warn('Could not persist browser event cursor', error); } } });
        client.onError((error) => state.setTransportStatus(`Connection failed: ${error.message}`));
        state.setTransportStatus('Connected · browser WebSocket');
      } catch (error) {
        state.setTransportStatus(`Connection failed: ${String(error)}`);
        void state.pairingApi.inspect().then((info) => state.setPairing(stateFromInfo(info))).catch(() => undefined);
      }
    })();
    return () => { disposed = true; client?.close(); };
  }, [state.autobench, state.pairing.kind, state.ready, state.reconnect]);
}

