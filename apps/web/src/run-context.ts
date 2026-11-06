// App module support.
import { invoke } from '@tauri-apps/api/core';
export const started = performance.now();
export const b4Enabled = new URLSearchParams(location.search).has('b4');

export function b4Trace(stage: string, data: Record<string, unknown> = {}) {
  if (b4Enabled) void invoke('b4_trace', { stage, data }).catch((error: unknown) => console.error('B4 trace command failed', error));
}
