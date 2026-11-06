// App module support.
import { useMemo, useRef, useState } from 'react';
import { activeMachineId, isRelayEnvironment } from './browser-pairing';
import type { PairingApi, PairingState } from './pairing';
import type { BrowserSession, ConnectionPhase, CreateFlight } from './browser-session';
import type { ApprovalFlight } from './session-model';

export function useAppState(browserMain: boolean, b4Enabled: boolean, browserMode: boolean, pairingApi: PairingApi) {
  const query = useMemo(() => new URLSearchParams(location.search), []), count = Math.max(0, Number(query.get('events') ?? 5000)), streams = Number(query.get('streams') ?? 4), durationMs = Number(query.get('duration') ?? 15000), autostart = query.has('events') && query.get('autostart') !== '0', autobench = query.has('autobench'), runId = query.get('run') ?? `${count}-${streams}`, [ready, setReady] = useState(false), [draft, setDraft] = useState(''), [running, setRunning] = useState(false), [benchStatus, setBenchStatus] = useState(''), [transportStatus, setTransportStatus] = useState('Disconnected'), [pairing, setPairing] = useState<PairingState>({ kind: 'loading' }), [pairingBusy, setPairingBusy] = useState(false), [enrollmentCode, setEnrollmentCode] = useState(''), [fallbackAcknowledged, setFallbackAcknowledged] = useState(false), [reconnect, setReconnect] = useState(0), [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>('connecting'), [approvalInFlight, setApprovalInFlight] = useState<ReadonlySet<string>>(() => new Set()), [approvalError, setApprovalError] = useState<string | null>(null), [promptError, setPromptError] = useState<string | null>(null);
  const isRelay = isRelayEnvironment();
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(() => activeMachineId());
  const [availableMachines, setAvailableMachines] = useState<{ machine_id: string; online: boolean }[]>([]);
  const browserSession = useRef<BrowserSession | null>(null);
  const approvalFlightRef = useRef<ApprovalFlight>({ inFlight: new Set(), error: null });
  const pendingPromptRef = useRef<{ commandId: string; sessionId: string } | null>(null);
  const createFlightRef = useRef<CreateFlight>({ pendingCommandId: null, acceptedCommandId: null });
  const selectedCreateRef = useRef<string | null>(null);
  const [promptClear, setPromptClear] = useState<{ commandId: string; sessionId: string } | null>(null);
  const [sessionWorkdirsState, setSessionWorkdirs] = useState<readonly string[] | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [dismissedSessionId, setDismissedSessionId] = useState<string | null>(null);
  const runningRef = useRef(false);
  const rangeRequest = useRef<{ key: string; id: number; inFlight: boolean; pending?: { start: number; limit: number; noticeVersion?: number } }>({ key: '', id: 0, inFlight: false });
  return { browserMain, b4Enabled, browserMode, pairingApi, query, count, streams, durationMs, autostart, autobench, runId, ready, setReady, draft, setDraft, running, setRunning, benchStatus, setBenchStatus, transportStatus, setTransportStatus, pairing, setPairing, pairingBusy, setPairingBusy, enrollmentCode, setEnrollmentCode, fallbackAcknowledged, setFallbackAcknowledged, reconnect, setReconnect, connectionPhase, setConnectionPhase, approvalInFlight, setApprovalInFlight, approvalError, setApprovalError, promptError, setPromptError, isRelay, currentMachineId, setCurrentMachineId, availableMachines, setAvailableMachines, browserSession, approvalFlightRef, pendingPromptRef, createFlightRef, selectedCreateRef, promptClear, setPromptClear, sessionWorkdirsState, setSessionWorkdirs, createError, setCreateError, createPending, setCreatePending, createdSessionId, setCreatedSessionId, dismissedSessionId, setDismissedSessionId, runningRef, rangeRequest };
}

export type AppStateBase = ReturnType<typeof useAppState>;
export type AppState = AppStateBase & { publishApprovalFlight: (action: import('./session-model').ApprovalFlightAction) => void };
