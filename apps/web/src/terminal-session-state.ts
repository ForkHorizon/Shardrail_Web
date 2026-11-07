// Persist browser selection and view mode without coupling to React state.
export type TerminalViewMode = 'chat' | 'terminal';

export interface TerminalStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const machineKey = (machineId: string) => encodeURIComponent(machineId);

export function browserTerminalStateStorage(): TerminalStateStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function selectedSessionStorageKey(machineId: string) {
  return `shardrail-selected-session:${machineKey(machineId)}`;
}

export function terminalViewStorageKey(machineId: string, sessionId: string) {
  return `shardrail-terminal-view:${machineKey(machineId)}:${encodeURIComponent(sessionId)}`;
}

export function restoreSelectedSession(storage: TerminalStateStorage | null, machineId: string): string | null {
  try {
    const sessionId = storage?.getItem(selectedSessionStorageKey(machineId));
    return sessionId && sessionId.length > 0 ? sessionId : null;
  } catch {
    return null;
  }
}

export function persistSelectedSession(storage: TerminalStateStorage | null, machineId: string, sessionId: string | null) {
  try {
    const key = selectedSessionStorageKey(machineId);
    if (sessionId) storage?.setItem(key, sessionId);
    else storage?.removeItem(key);
  } catch (error) {
    // Storage can be unavailable in private browsing; session navigation still works in memory.
    void error;
  }
}

export function restoreTerminalView(storage: TerminalStateStorage | null, machineId: string, sessionId: string): TerminalViewMode {
  try {
    return storage?.getItem(terminalViewStorageKey(machineId, sessionId)) === 'terminal' ? 'terminal' : 'chat';
  } catch {
    return 'chat';
  }
}

export function persistTerminalView(storage: TerminalStateStorage | null, machineId: string, sessionId: string, mode: TerminalViewMode) {
  try {
    const key = terminalViewStorageKey(machineId, sessionId);
    if (mode === 'terminal') storage?.setItem(key, mode);
    else storage?.removeItem(key);
  } catch (error) {
    // Storage can be unavailable in private browsing; view switching still works in memory.
    void error;
  }
}
