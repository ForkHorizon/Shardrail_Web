import React, { Profiler, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { usePairingEffects } from './pairing-effects';
import { useAppState } from './app-state';
import { useBrowserSessionEffect } from './session-effects';
import { useBrowserTransportEffect, useRequestRange } from './transport-effects';
import type { AppState, AppStateBase } from './app-state';
import { useBenchmarkEffects, type Tools } from './benchmark-effects';
import { b4Enabled, b4Trace, started } from './run-context';
import { listen } from '@tauri-apps/api/event';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Button, Input, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, TextField } from 'react-aria-components';
import { useVirtualizer } from '@tanstack/react-virtual';
import { createPortal } from 'react-dom';
import { applyDaemonEvent, daemonAgentChunkCount, daemonClockMapping, daemonReceiptToRafMs, eventCount, getRowStart, getRows, isLiveTail, markDaemonRowsCommitted, markRowsCommitted, observeJournalEpoch, pushToken, reset, rowCount, setDaemonAgentChunkCount, setDaemonAgentCount, setDaemonClockMapping, setDaemonTotal, setDaemonWindow, setLiveTail, sortedLatency, tokenCount, useRows } from './store';
import { matchedInFirstFrame, measureReadyCommitAfterFrame, nominalFrameIntervalMs, percentile, supportsLongTaskEntries, takeCommittedInput } from './metrics-utils';
import { createFrameSampler, intersectingVirtualItems } from './frame-sampler';
import { draftPreview, minimumB4Samples, shouldWaitForDaemonStream, waitForB4Samples, waitForDaemonStream } from './bench-utils';
import { UntrustedMarkdown } from './UntrustedMarkdown';
import { coalesceChannelFrame, liveTailWindowSize, rangeForWindow, sameMarkdownVersion, transcriptOverscan } from './streaming-view';
import { beginConfirmation, confirmPairing, stateFromInfo, unpairClient, type PairingApi, type PairingInfo, type PairingState } from './pairing';
import { activeMachineId, browserPairingApi, browserWebSocketUrl, defaultRelayUrl, isRelayEnvironment, setActiveMachineId } from './browser-pairing';
import { connectBrowser, connectBrowserRelay, discoverRelayMachines, openBrowserKeyStore } from '@shardrail/client/browser';
import { createBrowserSession, createFlightOnControl, createFlightOnSessionCreated, isKeyChangedError, noteCreateSent, sessionWorkdirs, type BrowserSession, type ConnectionPhase, type CreateFlight, type CreateFlightResult } from './browser-session';
import { approvalIdFromPayload, clearPromptOnAccept, controlFailureTarget, reduceApprovalFlight, type ApprovalBindingEcho, type ApprovalFlight, type ApprovalFlightAction } from './session-model';
import { MainScreen } from './MainScreen';
import { BrowserSessionScreen, PairingGate } from './app-screens';
import { PairingScreen } from './screens/entry/PairingScreen';
import './styles/index.css';

type Metrics = { firstTranscriptRenderOpportunityMs: number; longTasks: number | null; maxLongTaskMs: number | null; frameP95: number | null; frameMax: number | null; frameSamples: number; commitCount: number; commitMs: number; eventStoreCount: number; generatedTokens: number; heapMB: number | null; mockCreationToMountedRowFollowupP95: number | null; composerP95: number | null; composerMin: number | null; composerMax: number | null; composerSamples: number; matchesByFirstFrame: number; firstFrameSamples: number; firstFrameDeltasMs: number[]; firstFrameRafTimestampDeltasMs: number[]; b4: { count: number; medianMs: number | null; p95Ms: number | null; maxMs: number | null; samplesMs: number[]; clockOffsetMs: number; clockUncertaintyMs: number }; daemonAgentChunkCount: number; userAgent: string };
const browserMode = !('__TAURI_INTERNALS__' in window);
const browserMain = browserMode && !b4Enabled;
const desktopPairingApi: PairingApi = {
  inspect: () => invoke<PairingInfo>('pairing_info'),
  pair: (daemonPublicKey) => invoke<string>('pair_desktop', { expectedPublicKey: daemonPublicKey }),
  unpair: () => invoke('unpair_desktop'),
};
const pairingApi = browserMode ? browserPairingApi : desktopPairingApi;
if (b4Enabled) {
  window.addEventListener('error', (event) => b4Trace('window.onerror', { message: event.message, source: event.filename, line: event.lineno, column: event.colno }));
  window.addEventListener('unhandledrejection', (event) => b4Trace('unhandledrejection', { reason: String(event.reason) }));
}
const observed = { longTasks: 0, maxLongTaskMs: 0, frames: [] as number[], commits: 0, commitMs: 0, inputs: [] as number[], firstFrame: [] as boolean[], firstFrameTimestamps: [] as number[], rafTimestampDeltas: [] as number[] };
const pendingInputs: { startedAt: number; draft: string }[] = [];
const supportsLongTasks = typeof PerformanceObserver !== 'undefined' && supportsLongTaskEntries(PerformanceObserver.supportedEntryTypes);
if (supportsLongTasks) new PerformanceObserver((list) => list.getEntries().forEach((e) => { observed.longTasks++; observed.maxLongTaskMs = Math.max(observed.maxLongTaskMs, e.duration); })).observe({ type: 'longtask', buffered: true });
const frameSampler = createFrameSampler(requestAnimationFrame, cancelAnimationFrame, (elapsed) => {
  observed.frames.push(elapsed);
  if (observed.frames.length > 12000) observed.frames.shift();
}, () => performance.now());
function startFrameSampling() { observed.frames.length = 0; frameSampler.start(); }
function stopFrameSampling() { frameSampler.stop(); }
function startStreams(streams: number, durationMs: number, running: { current: boolean }, setRunning: (value: boolean) => void) {
  if (running.current) return;
  running.current = true;
  setRunning(true);
  startFrameSampling();
  for (let agent = 0; agent < streams; agent++) {
    let seq = 0;
    const timer = window.setInterval(() => pushToken(agent, seq++), 1000 / 75);
    window.setTimeout(() => { clearInterval(timer); running.current = false; stopFrameSampling(); setRunning(false); }, durationMs);
  }
}
function metrics(): Metrics {
  const frames = [...observed.frames].sort((a, b) => a - b), ls = sortedLatency();
  const inputs = [...observed.inputs].sort((a, b) => a - b);
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  const b4 = [...daemonReceiptToRafMs].sort((a, b) => a - b), clock = daemonClockMapping();
  return { firstTranscriptRenderOpportunityMs: (window as Window & { __firstTranscriptRenderOpportunityMs?: number }).__firstTranscriptRenderOpportunityMs ?? 0, longTasks: supportsLongTasks ? observed.longTasks : null, maxLongTaskMs: supportsLongTasks ? observed.maxLongTaskMs : null, frameP95: percentile(frames, .95), frameMax: frames.at(-1) ?? null, frameSamples: observed.frames.length, commitCount: observed.commits, commitMs: observed.commitMs, eventStoreCount: eventCount(), generatedTokens: tokenCount(), heapMB: memory ? +(memory / 1048576).toFixed(1) : null, mockCreationToMountedRowFollowupP95: percentile(ls, .95), composerP95: percentile(observed.inputs, .95), composerMin: inputs[0] ?? null, composerMax: inputs.at(-1) ?? null, composerSamples: observed.inputs.length, matchesByFirstFrame: observed.firstFrame.filter(Boolean).length, firstFrameSamples: observed.firstFrame.length, firstFrameDeltasMs: [...observed.firstFrameTimestamps], firstFrameRafTimestampDeltasMs: [...observed.rafTimestampDeltas], b4: { count: b4.length, medianMs: percentile(b4, .5), p95Ms: percentile(b4, .95), maxMs: b4.at(-1) ?? null, samplesMs: b4, clockOffsetMs: clock.offsetMs, clockUncertaintyMs: clock.uncertaintyMs }, daemonAgentChunkCount, userAgent: navigator.userAgent };
}
Object.assign(window, { __s5Metrics: metrics, __s5ResetInputTrace: () => { observed.inputs.length = 0; observed.firstFrame.length = 0; observed.firstFrameTimestamps.length = 0; observed.rafTimestampDeltas.length = 0; pendingInputs.length = 0; }, __firstTranscriptRenderOpportunityMs: 0 });

const Markdown = memo(({ source }: { rowId: number; source: string; contentHash: string; contentVersion: number }) => {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    const style = doc.createElement('style');
    style.textContent = 'body{margin:0;background:transparent;color:#e6e8ed;font:inherit}p{margin:4px 0;color:inherit}a{color:#77c5e5}';
    doc.head.append(style);
    const root = doc.createElement('div');
    root.id = 'markdown-root';
    doc.body.append(root);
    setTarget(root);
  }, []);
  const content = <UntrustedMarkdown source={source}/>;
  return <iframe ref={frameRef} title="Agent-authored Markdown" sandbox="allow-same-origin" className="markdown-frame">{target ? createPortal(content, target) : null}</iframe>;
}, sameMarkdownVersion);
function useDaemonTransportEffect(state: AppStateBase, requestRange: ReturnType<typeof useRequestRange>) {
  useEffect(() => {
    if (!state.ready || (state.b4Enabled && (!state.autobench || !state.query.has('b4'))) || (!state.b4Enabled && state.pairing.kind !== 'paired') || state.browserMain || state.browserMode) return;
    if (state.b4Enabled) {
      const offsets: number[] = [];
      for (let i = 0; i < 5; i++) { const before = performance.now(), wall = Date.now(), after = performance.now(); offsets.push(wall - (before + after) / 2); }
      setDaemonClockMapping(offsets.reduce((a, b) => a + b, 0) / offsets.length, (Math.max(...offsets) - Math.min(...offsets)) / 2 + 1);
    }
    let unlistenStatus: (() => void) | undefined;
    const channel = new Channel<{ version: number; total: number; agentChunkCount: number }>();
    const removeChannel = coalesceChannelFrame(channel, (notice) => {
      setDaemonTotal(notice.total, false);
      setDaemonAgentChunkCount(notice.agentChunkCount);
      if (isLiveTail()) {
        state.rangeRequest.current.key = '';
        const size = liveTailWindowSize(state.b4Enabled);
        requestRange(Math.max(0, notice.total - size), size, notice.version);
      } else {
        setDaemonTotal(notice.total);
        void invoke('acknowledge_stream_view', { version: notice.version }).catch((error: unknown) => state.setTransportStatus(`Stream acknowledgement failed: ${String(error)}`));
      }
    });
    void listen<{ connected: boolean; error?: string }>('daemon-status', (event) => {
      const status = event.payload;
      b4Trace('daemon status received', status);
      (window as Window & { __daemonConnected?: boolean }).__daemonConnected = status.connected;
      if (status.connected) (window as Window & { __daemonConnectedOnce?: boolean }).__daemonConnectedOnce = true;
      state.setTransportStatus(status.connected ? 'Connected · local shell relay' : status.error ? `Connection failed: ${status.error}` : 'Disconnected');
    }).then((remove) => { unlistenStatus = remove; state.setTransportStatus('Frontend channel ready'); b4Trace('ready', { channel: 'daemon-frames', events: state.count });
      return invoke(state.b4Enabled ? 'start_b4_relay' : 'start_paired_relay', { onFrames: channel, streams: Math.max(1, Math.min(8, state.streams)) });
    }).catch((error: unknown) => {
      if (state.b4Enabled) { state.setTransportStatus(`Connection failed: ${String(error)}`); b4Trace('relay setup rejected', { error: String(error) }); console.error('S5 channel setup failed', error); }
      else { state.setTransportStatus('Connection failed · check daemon and pairing'); void state.pairingApi.inspect().then((info) => state.setPairing(stateFromInfo(info))).catch(() => undefined); }
    });
    return () => { unlistenStatus?.(); removeChannel(); };
  }, [state.autobench, state.count, state.pairing.kind, state.query, state.ready, state.reconnect, requestRange, state.streams]);
}

async function runAutomation(state: AppStateBase, tools: Tools, cancelled: () => boolean) {
  const query = state.query;
  state.setBenchStatus('Automated run started');
  b4Trace('automation started', { visibility: document.visibilityState, focused: document.hasFocus() });
  if (!query.has('b4')) await typeComposer(state);
  else b4Trace('B4 automation input skipped', { reason: 'synthetic composer input is outside the daemon-to-row measurement' });
  if (state.autobench && shouldWaitForDaemonStream(query, state.count)) {
    state.setBenchStatus('Waiting for shell relay and daemon fake-agent stream');
    b4Trace('completion wait started', { expectedAgentChunks: state.count, connectedOnce: Boolean((window as Window & { __daemonConnectedOnce?: boolean }).__daemonConnectedOnce) });
    await waitForDaemonStream(state.count, () => daemonAgentChunkCount, () => Boolean((window as Window & { __daemonConnectedOnce?: boolean }).__daemonConnectedOnce));
    const minimumSamples = minimumB4Samples(state.count);
    b4Trace('sample wait started', { expectedSamples: minimumSamples });
    await waitForB4Samples(minimumSamples, () => daemonReceiptToRafMs.length);
  }
  b4Trace('completion condition evaluated', { expectedAgentChunks: state.count, frontendAgentChunks: daemonAgentChunkCount, expectedSamples: minimumB4Samples(state.count), samples: daemonReceiptToRafMs.length, connectedOnce: Boolean((window as Window & { __daemonConnectedOnce?: boolean }).__daemonConnectedOnce), rows: eventCount() });
  const el = document.querySelector<HTMLElement>('.transcript')!;
  if (!query.has('b4')) {
    tools.startFrameSampling();
    for (let step = 0; step < 60; step++) { el.scrollTop = (el.scrollTop + 14) % Math.max(1, el.scrollHeight - el.clientHeight); await new Promise((resolve) => setTimeout(resolve, 16)); }
  }
  if (state.autostart) await new Promise<void>((resolve) => { const wait = () => document.querySelector('footer')?.textContent?.includes('Streams running') ? window.setTimeout(wait, 50) : resolve(); wait(); });
  tools.stopFrameSampling();
  if (cancelled()) return;
  b4Trace('rows committed', { rows: eventCount() });
  const samples = tools.metrics();
  b4Trace('samples collected', { count: samples.b4.count, daemonAgentChunkCount: samples.daemonAgentChunkCount });
  const required = Math.ceil(state.streams * 75 * state.durationMs / 1000 * 0.5);
  if (state.autostart && samples.generatedTokens < required) throw new Error(`Generated stream load ${samples.generatedTokens} < required ${required}`);
  const scrollFrames = [...tools.observed.frames];
  const result = { date: new Date().toISOString(), events: state.count, temperature: query.get('temperature') ?? 'unspecified', streams: state.streams, pageVisibility: document.visibilityState, pageFocused: document.hasFocus(), inputMethod: query.has('b4') ? 'not used for B4 daemon stream measurement' : 'Synthetic InputEvent dispatched to the focused composer', ...samples, scrollSmoothness: { frameP95Ms: percentile(scrollFrames, .95), frameMaxMs: Math.max(...scrollFrames), frames: scrollFrames.length } };
  state.setBenchStatus('Saving results');
  b4Trace('report fetch started', { url: 'http://127.0.0.1:5174/result', bodyBytes: JSON.stringify({ filename: state.runId, result }).length });
  let response: Response;
  try { response = await fetch('http://127.0.0.1:5174/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: state.runId, result }) }); }
  catch (error) { b4Trace('report fetch rejected', { error: String(error) }); throw error; }
  b4Trace('report fetch resolved', { status: response.status, ok: response.ok });
  if (!response.ok) throw new Error(`Result receiver returned HTTP ${response.status}`);
  state.setBenchStatus('Results saved');
}

async function typeComposer(state: AppStateBase) {
  await new Promise((resolve) => setTimeout(resolve, state.autostart ? 2200 : 600));
  b4Trace('automation delay complete', { visibility: document.visibilityState, focused: document.hasFocus() });
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Message composer"]');
  if (!field) throw new Error('Composer was not rendered');
  field.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  for (const char of '/s5-paint-responsiveness-trace') { setter?.call(field, field.value + char); field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char })); await new Promise((resolve) => setTimeout(resolve, 40)); }
  await new Promise((resolve) => setTimeout(resolve, 100));
  b4Trace('automation input complete');
}

function Row({ row, onMount, onUnmount }: { row: ReturnType<typeof getRows>[number]; onMount: (id: number) => void; onUnmount: (id: number) => void }) {
  return <article ref={(node) => { if (row.id >= 1_000_000_000) { if (node) onMount(row.id); else onUnmount(row.id); } }} className={`event ${row.kind}`}><div className="meta"><b>Agent {row.agent + 1}</b><span>{row.kind === 'approval' ? 'approval requested' : row.kind === 'tool' ? 'tool call' : 'message'} · #{row.id}</span><time>{new Date().toLocaleTimeString()}</time></div>{row.kind === 'approval' ? <><pre>{row.command}</pre><div className="untrusted"><b>Agent’s description · untrusted</b><Markdown rowId={row.id} source={row.text} contentHash={row.contentHash} contentVersion={row.contentVersion}/></div><small>Checklist: sandbox not verified · approval routing not verified · containment not verified</small></> : row.kind === 'tool' ? <><pre>{row.command}</pre><small>{row.cwd}</small></> : <div className="body"><Markdown rowId={row.id} source={row.text} contentHash={row.contentHash} contentVersion={row.contentVersion}/></div>}</article>;
}
function Transcript({ onInput, ready, requestRange }: { onInput: () => void; ready: boolean; requestRange: (start: number, limit: number) => void }) {
  const rows = useRows();
  const parent = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  const firstPaintMeasured = useRef(false);
  const mountedDaemonRows = useRef(new Set<number>());
  // TanStack Virtual returns imperative methods that React Compiler cannot safely memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({ count: rowCount(), getScrollElement: () => parent.current, estimateSize: () => 112, overscan: transcriptOverscan(b4Enabled) });
  const virtualItems = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    if (followTail.current && parent.current) parent.current.scrollTop = parent.current.scrollHeight;
    const viewport = parent.current;
    const intersectingItems = viewport ? intersectingVirtualItems(virtualItems, viewport.scrollTop, viewport.clientHeight) : [];
    const mountedRows = virtualItems.flatMap((item) => rows[item.index - getRowStart()] ? [rows[item.index - getRowStart()]!] : []);
    const visibleRows = intersectingItems.flatMap((item) => rows[item.index - getRowStart()] ? [rows[item.index - getRowStart()]!] : []);
    markRowsCommitted(mountedRows.map((row) => row.id));
    markDaemonRowsCommitted(
      visibleRows.map((row) => row.id),
      requestAnimationFrame,
      () => performance.now(),
      (id) => mountedDaemonRows.current.has(id),
    );
    if (ready && !firstPaintMeasured.current) {
      firstPaintMeasured.current = true;
      measureReadyCommitAfterFrame(true, started, () => performance.now(), requestAnimationFrame, (callback) => window.setTimeout(callback, 0), (elapsed) => { (window as Window & { __firstTranscriptRenderOpportunityMs?: number }).__firstTranscriptRenderOpportunityMs = elapsed; });
    }
  }, [rows, virtualItems, ready]);
  useEffect(() => {
    const first = virtualItems[0]?.index;
    if (first !== undefined) requestRange(first, Math.max(1, (virtualItems.at(-1)?.index ?? first) - first + 1));
  }, [virtualItems, requestRange]);
  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable transcript needs keyboard focus
  return <><div ref={parent} className="transcript" role="region" aria-label="Event transcript" tabIndex={0} onScroll={() => { followTail.current = parent.current !== null && parent.current.scrollHeight - parent.current.scrollTop - parent.current.clientHeight < 24; setLiveTail(followTail.current); onInput(); }}><div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>{virtualItems.map((v) => { const row = rows[v.index - getRowStart()]; return row ? <div key={row.id} data-index={v.index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 112, transform: `translateY(${v.start}px)` }}><Row row={row} onMount={(id) => mountedDaemonRows.current.add(id)} onUnmount={(id) => mountedDaemonRows.current.delete(id)}/></div> : null; })}</div></div></>;
}

function App() {
  const appState = useAppState(browserMain, b4Enabled, browserMode, pairingApi);
  const { query, count, streams, durationMs, autostart, autobench, runId, ready, setReady, draft, setDraft, running, setRunning, benchStatus, setBenchStatus, transportStatus, setTransportStatus, pairing, setPairing, pairingBusy, setPairingBusy, enrollmentCode, setEnrollmentCode, fallbackAcknowledged, setFallbackAcknowledged, reconnect, setReconnect, connectionPhase, setConnectionPhase, approvalInFlight, setApprovalInFlight, approvalError, setApprovalError, promptError, setPromptError, isRelay, currentMachineId, setCurrentMachineId, availableMachines, setAvailableMachines, browserSession, approvalFlightRef, pendingPromptRef, createFlightRef, selectedCreateRef, promptClear, setPromptClear, sessionWorkdirsState, setSessionWorkdirs, createError, setCreateError, createPending, setCreatePending, createdSessionId, setCreatedSessionId, dismissedSessionId, setDismissedSessionId, runningRef, rangeRequest } = appState;
  const publishApprovalFlight = (action: ApprovalFlightAction) => {
    const next = reduceApprovalFlight(approvalFlightRef.current, action);
    if (next === approvalFlightRef.current) return;
    approvalFlightRef.current = next;
    setApprovalInFlight(next.inFlight);
    setApprovalError(next.error);
  };
  const effectState = { ...appState, publishApprovalFlight };
  // Readiness gates the generator until the external store has been initialized.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reset(browserMain ? 0 : count, streams, !b4Enabled && !browserMain); setDaemonAgentCount(streams); setReady(true); }, [count, streams]);
  usePairingEffects(effectState);
  useBrowserSessionEffect(effectState);
  const requestRange = useRequestRange(appState);
  useBrowserTransportEffect(effectState);
  useDaemonTransportEffect(effectState, requestRange);
  useBenchmarkEffects(effectState, { observed, pendingInputs, metrics, startFrameSampling, stopFrameSampling, startStreams }, runAutomation);
  function profiler(_: string, __: string, duration: number) { observed.commits++; observed.commitMs += duration; }
  function handleInput(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;
    pendingInputs.push({ startedAt: performance.now(), draft: value });
    setDraft(value);
  }
  function updateQuery(key: string, value: string) { const u = new URL(location.href); u.searchParams.set(key, value); window.location.assign(u.toString()); }
  const select = (label: string, value: string, options: string[], onChange: (value: string) => void) => <Select aria-label={label} selectedKey={value} onSelectionChange={(key) => onChange(String(key))}><Label>{label}</Label><Button><SelectValue/><span aria-hidden="true">⌄</span></Button><Popover><ListBox>{options.map((option) => <ListBoxItem key={option} id={option}>{option}</ListBoxItem>)}</ListBox></Popover></Select>;
  if (!b4Enabled && pairing.kind !== 'paired') return <PairingGate state={effectState}/>;
  if (browserMain && pairing.kind === 'paired') return <BrowserSessionScreen state={effectState}/>;
  return <main><header><div><h1>Shardrail · S5 UI load</h1><p>Mock content · no provider connections</p></div><div className="controls">{pairing.kind === 'paired' ? <><span className="paired-fingerprint" aria-label="Paired daemon fingerprint" title={pairing.info.fingerprint}>{pairing.info.fingerprint}</span><Button onPress={() => setReconnect((current) => current + 1)}>Reconnect</Button>{!browserMode ? <Button onPress={() => { void unpairClient(pairingApi).then(setPairing); }}>Unpair</Button> : null}</> : null}{select('Events', String(count), ['0', '5000', '50000'], (value) => updateQuery('events', value))}{select('Streams', String(streams), ['1', '4', '8'], (value) => updateQuery('streams', value))}<Button onPress={() => startStreams(streams, durationMs, runningRef, setRunning)}>Start mock streams</Button></div></header>{browserMode && pairing.kind === 'paired' && pairing.info.keyStorage === 'noble-fallback' ? <p role="note">This browser stores an extractable private key seed in IndexedDB because non-extractable WebCrypto is unavailable. Same-origin script can read it.</p> : null}<section className="status"><span>{ready ? `${eventCount().toLocaleString()} events loaded · ${streams} streams` : 'Loading'}</span><span>{transportStatus} · Metrics: window.__s5Metrics()</span></section><TextField className="composer"><Label>Message</Label><Input aria-label="Message composer" value={draft} placeholder="Type to measure input responsiveness" onChange={handleInput}/><output className="draft-preview" data-draft={draft} aria-live="polite">{draftPreview(draft)}</output></TextField><Profiler id="transcript" onRender={profiler}><Transcript ready={ready} onInput={() => {}} requestRange={requestRange}/></Profiler><footer>{benchStatus || 'Mock content only'} · {running ? 'Streams running' : 'Ready'}</footer></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
