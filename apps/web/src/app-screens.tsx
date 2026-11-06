// Pairing and connected browser screens for the app shell.
import { MainScreen } from './MainScreen';
import { PairingScreen } from './screens/entry/PairingScreen';
import { beginConfirmation, confirmPairing, stateFromInfo } from './pairing';
import { setActiveMachineId } from './browser-pairing';
import { noteCreateSent } from './browser-session';
import type { ApprovalBindingEcho } from './session-model';
import type { AppState } from './app-state';

export function PairingGate({ state }: { state: AppState }) {
  const info = 'info' in state.pairing ? state.pairing.info : undefined;
  const verify = () => { if (info) { state.setFallbackAcknowledged(false); state.setPairing(beginConfirmation(info)); } };
  const refresh = () => {
    state.setPairing({ kind: 'loading' });
    void state.pairingApi.inspect().then((next) => state.setPairing(stateFromInfo(next))).catch((err) => {
      state.setPairing({ kind: 'error', message: err instanceof Error ? err.message : 'Could not read daemon identity. Check that the daemon is available and retry.' });
    });
  };
  const selectMachine = (machineId: string) => {
    setActiveMachineId(machineId);
    state.setCurrentMachineId(machineId);
    state.setPairing({ kind: 'loading' });
    void state.pairingApi.inspect().then((next) => state.setPairing(stateFromInfo(next))).catch((err) => state.setPairing({ kind: 'error', message: err instanceof Error ? err.message : 'Could not read daemon identity.' }));
  };
  return <PairingScreen state={state.pairing} browserMode={state.browserMode} busy={state.pairingBusy} enrollmentCode={state.enrollmentCode} fallbackAcknowledged={state.fallbackAcknowledged} onCode={state.setEnrollmentCode} onAcknowledge={state.setFallbackAcknowledged} onReview={verify} onRetry={refresh} onPair={() => { state.setPairingBusy(true); void confirmPairing(state.pairing, state.pairingApi, undefined, state.enrollmentCode, state.fallbackAcknowledged).then(state.setPairing).finally(() => state.setPairingBusy(false)); }} onCancel={() => { state.setEnrollmentCode(''); state.setFallbackAcknowledged(false); if (info) state.setPairing(stateFromInfo(info)); }} onReset={() => { void state.pairingApi.unpair().then(refresh); }} isRelay={state.isRelay} machineId={state.currentMachineId} availableMachines={state.availableMachines} onSelectMachine={selectMachine}/>;
}

export function BrowserSessionScreen({ state }: { state: AppState }) {
  if (state.pairing.kind !== 'paired') return null;
  const resolveApproval = (approvalId: string, optionId: string, binding: ApprovalBindingEcho) => {
    const result = state.browserSession.current?.resolveApproval(approvalId, optionId, binding) ?? 'blocked';
    state.publishApprovalFlight(result === 'sent' ? { type: 'sent', approvalId } : { type: 'blocked' });
  };
  const sendCommand = (kind: 'turn.start' | 'turn.interrupt' | 'session.resume', payload: Record<string, unknown>, blocked: string) => {
    const commandId = crypto.randomUUID();
    const result = state.browserSession.current?.request({ command_id: commandId, kind, payload, expected_state: null, expected_turn_id: null }) ?? 'blocked';
    if (kind === 'turn.start' && result === 'sent' && typeof payload.session_id === 'string') state.pendingPromptRef.current = { commandId, sessionId: payload.session_id };
    state.setPromptError(result === 'sent' ? null : blocked);
  };
  const createSession = (workdir: string, agentKind = 'codex') => {
    const commandId = crypto.randomUUID();
    const result = state.browserSession.current?.request({ command_id: commandId, kind: 'session.create', payload: { workdir, agent_kind: agentKind }, expected_state: null, expected_turn_id: null }) ?? 'blocked';
    if (result !== 'sent') { state.setCreatePending(false); state.setCreateError('Not connected. The session was not created.'); return; }
    state.createFlightRef.current = noteCreateSent(commandId);
    state.setCreatePending(true);
    state.setCreateError(null);
  };
  const keyStorage = state.pairing.info.keyStorage;
  return <MainScreen phase={state.connectionPhase} {...(keyStorage ? { keyStorage } : {})} approvalInFlight={state.approvalInFlight} approvalError={state.approvalError} promptError={state.promptError} promptClear={state.promptClear} workdirs={state.sessionWorkdirsState} createError={state.createError} createPending={state.createPending} createdSessionId={state.createdSessionId} dismissedSessionId={state.dismissedSessionId} onReconnect={() => { if (state.browserSession.current) state.browserSession.current.reconnect(); else state.setReconnect((current) => current + 1); }} onUnpair={state.isRelay ? () => { void state.pairingApi.unpair().then(() => state.pairingApi.inspect()).then((next) => state.setPairing(stateFromInfo(next))); } : undefined} onResolveApproval={resolveApproval} onSendPrompt={(sessionId, prompt) => sendCommand('turn.start', { session_id: sessionId, prompt }, 'Not connected. The prompt was not sent.')} onInterrupt={(sessionId) => sendCommand('turn.interrupt', { session_id: sessionId }, 'Not connected. Interrupt was not sent.')} onTakeOver={(sessionId) => sendCommand('session.resume', { session_id: sessionId, take_over: true }, 'Not connected. Take over request was not sent.')} onCreateSession={createSession}/>;
}
