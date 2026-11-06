// Input and synthetic load measurement effects.
import { useEffect, useLayoutEffect } from 'react';
import { daemonAgentChunkCount, daemonReceiptToRafMs, eventCount } from './store';
import { percentile } from './metrics-utils';
import { matchedInFirstFrame, nominalFrameIntervalMs, takeCommittedInput } from './metrics-utils';
import { minimumB4Samples, shouldWaitForDaemonStream, waitForB4Samples, waitForDaemonStream } from './bench-utils';
import { b4Trace } from './run-context';
import type { AppStateBase } from './app-state';

type Observed = { inputs: number[]; firstFrame: boolean[]; firstFrameTimestamps: number[]; rafTimestampDeltas: number[]; frames: number[] };
export type Tools = { observed: Observed; pendingInputs: { startedAt: number; draft: string }[]; metrics: () => { generatedTokens: number; b4: { count: number }; daemonAgentChunkCount: number }; startFrameSampling: () => void; stopFrameSampling: () => void; startStreams: (streams: number, durationMs: number, running: { current: boolean }, setRunning: (value: boolean) => void) => void };

export type AutomationRunner = (state: AppStateBase, tools: Tools, cancelled: () => boolean) => Promise<void>;

export function useBenchmarkEffects(state: AppStateBase, tools: Tools, runAutomation: AutomationRunner) {
  useInputMetricsEffect(state.draft, tools);
  useAutoStartEffect(state, tools);
  useAutomationEffect(state, tools, runAutomation);
}

function useInputMetricsEffect(draft: string, tools: Tools) {
  useLayoutEffect(() => {
    const input = takeCommittedInput(tools.pendingInputs, draft);
    if (!input) return;
    requestAnimationFrame((frameTime) => {
      const preview = document.querySelector<HTMLElement>('.draft-preview');
      const frame = matchedInFirstFrame(input.startedAt, frameTime, performance.now(), preview?.dataset.draft === input.draft, nominalFrameIntervalMs);
      tools.observed.inputs.push(frame.delay);
      tools.observed.firstFrame.push(frame.matched);
      tools.observed.firstFrameTimestamps.push(frame.delay);
      tools.observed.rafTimestampDeltas.push(frame.frameTimestampDelta);
    });
  }, [draft]);
}

function useAutoStartEffect(state: AppStateBase, tools: Tools) {
  useEffect(() => {
    if (!state.autostart || !state.ready) return;
    const id = setTimeout(() => tools.startStreams(state.streams, state.durationMs, state.runningRef, state.setRunning), 1000);
    return () => clearTimeout(id);
  }, [state.ready, state.autostart, state.streams, state.durationMs]);
}

function useAutomationEffect(state: AppStateBase, tools: Tools, runAutomation: AutomationRunner) {
  useEffect(() => {
    b4Trace('automation effect evaluated', { ready: state.ready, autobench: state.autobench, visibility: document.visibilityState, focused: document.hasFocus() });
    if (!state.ready || !state.autobench) return;
    let cancelled = false;
    void runAutomation(state, tools, () => cancelled).catch(async (error: unknown) => {
      state.setBenchStatus(`Run failed: ${String(error)}`);
      b4Trace('bench rejected', { error: String(error), frontendAgentChunks: daemonAgentChunkCount, samples: daemonReceiptToRafMs.length });
      console.error('S5 automated run failed', error);
      if (state.autobench) await fetch('http://127.0.0.1:5174/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: state.runId, result: { error: String(error), events: state.count, streams: state.streams, daemonAgentChunkCount, b4: { count: daemonReceiptToRafMs.length } } }) }).catch(() => undefined);
    });
    return () => { cancelled = true; };

  }, [state.ready, state.autostart, state.autobench, state.durationMs, state.count, state.streams, state.runId, state.query]);
}
