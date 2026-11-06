import { useMemo, useState } from 'react';
import { Button } from 'react-aria-components';
import { approvalsForSession, checklistSummary, eventsForSession, hostBanner, sessionChecks, sessionSummaries, transcriptItems, type ApprovalBindingEcho } from './session-model';
import { mergeDiscoveredSessions } from './discovered-session-model';
import { connectionStatusLabel, type ConnectionPhase } from './browser-session';
import { requestDiscoveredHistory, useDiscoveredHistory, useDiscoveredSessions, useSessionJournalEvents } from './store';
import { EntryArea } from './screens/entry/EntryArea';
import { SessionArea } from './screens/session/SessionArea';
import { ThemeToggle } from './ui/ThemeToggle';
import { Icon } from './ui/Icon';
import { StatusPill } from './ui/StatusPill';
import { EmptyState } from './ui/EmptyState';
import { HierarchyNav, type MachineEntry } from './ui/HierarchyNav';

export function MainScreen({
  phase,
  keyStorage,
  approvalInFlight,
  approvalError,
  promptError,
  promptClear,
  workdirs,
  createError,
  createPending,
  createdSessionId,
  dismissedSessionId,
  onReconnect,
  onUnpair,
  onResolveApproval,
  onSendPrompt,
  onInterrupt,
  onTakeOver,
  onCreateSession,
  machines: propsMachines,
  selectedMachineId: propsSelectedMachineId,
  onSelectMachine,
}: {
  phase: ConnectionPhase;
  keyStorage?: 'webcrypto' | 'noble-fallback';
  approvalInFlight: ReadonlySet<string>;
  approvalError: string | null;
  promptError: string | null;
  promptClear: { commandId: string; sessionId: string } | null;
  workdirs: readonly string[] | null;
  createError: string | null;
  createPending: boolean;
  createdSessionId: string | null;
  dismissedSessionId: string | null;
  onReconnect: () => void;
  onUnpair?: (() => void) | undefined;
  onResolveApproval: (approvalId: string, optionId: string, binding: ApprovalBindingEcho) => void;
  onSendPrompt: (sessionId: string, prompt: string) => void;
  onInterrupt: (sessionId: string) => void;
  onTakeOver?: ((sessionId: string) => void) | undefined;
  onCreateSession: (workdir: string, agentKind?: string) => void;
  machines?: readonly MachineEntry[];
  selectedMachineId?: string | null;
  onSelectMachine?: (id: string | null) => void;
}) {
  const events = useSessionJournalEvents();
  const discoveredSessions = useDiscoveredSessions();
  const discoveredHistory = useDiscoveredHistory();
  const sessions = useMemo(() => mergeDiscoveredSessions(sessionSummaries(events), discoveredSessions), [events, discoveredSessions]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedCreateId, setAppliedCreateId] = useState<string | null>(null);
  const [appliedDismissId, setAppliedDismissId] = useState<string | null>(null);
  let nextSelected = selectedId;
  if (createdSessionId && createdSessionId !== appliedCreateId) { setAppliedCreateId(createdSessionId); nextSelected = createdSessionId; }
  if (dismissedSessionId && dismissedSessionId !== appliedDismissId) {
    setAppliedDismissId(dismissedSessionId);
    if (nextSelected === dismissedSessionId) nextSelected = null;
  }
  if (nextSelected !== selectedId) setSelectedId(nextSelected);
  const [pickedWorkdir, setPickedWorkdir] = useState('');
  const [confirmingAllowId, setConfirmingAllowId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [selectedMachineIdState, setSelectedMachineIdState] = useState<string | null>(propsSelectedMachineId ?? 'local');
  const selectedMachineId = propsSelectedMachineId !== undefined ? propsSelectedMachineId : selectedMachineIdState;
  const handleSelectMachine = (id: string | null) => {
    setSelectedMachineIdState(id);
    if (onSelectMachine) onSelectMachine(id);
  };
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const machines = useMemo(() => {
    if (propsMachines && propsMachines.length > 0) {
      return propsMachines.map((m) => ({
        ...m,
        sessionCount: m.sessionCount ?? sessions.filter((s) => s.machineId === m.id || (m.id === 'local' && (!s.machineId || s.machineId === 'local'))).length,
      }));
    }
    return [
      { id: 'local', name: 'Local Machine', isOnline: phase === 'connected', sessionCount: sessions.length }
    ];
  }, [propsMachines, phase, sessions]);

  const machineFilteredSessions = useMemo(() => {
    if (!selectedMachineId || selectedMachineId === 'local' || machines.length <= 1) return sessions;
    return sessions.filter((s) => s.machineId === selectedMachineId);
  }, [sessions, selectedMachineId, machines.length]);

  const agents = useMemo(() => {
    const codexCount = machineFilteredSessions.filter((s) => s.agentKind?.toLowerCase().includes('codex')).length;
    const claudeCount = machineFilteredSessions.filter((s) => s.agentKind?.toLowerCase().includes('claude')).length;
    const otherCount = machineFilteredSessions.length - codexCount - claudeCount;
    const list = [
      { name: 'codex', label: 'Codex', sessionCount: codexCount },
      { name: 'claude_code', label: 'Claude Code', sessionCount: claudeCount },
    ];
    if (otherCount > 0) {
      list.push({ name: 'other', label: 'Other', sessionCount: otherCount });
    }
    return list;
  }, [machineFilteredSessions]);

  const agentFilteredSessions = useMemo(() => {
    if (!selectedAgent) return machineFilteredSessions;
    if (selectedAgent === 'codex') return machineFilteredSessions.filter((s) => s.agentKind?.toLowerCase().includes('codex'));
    if (selectedAgent === 'claude_code') return machineFilteredSessions.filter((s) => s.agentKind?.toLowerCase().includes('claude'));
    return machineFilteredSessions.filter((s) => !s.agentKind?.toLowerCase().includes('codex') && !s.agentKind?.toLowerCase().includes('claude'));
  }, [machineFilteredSessions, selectedAgent]);

  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const approvals = useMemo(() => selected ? approvalsForSession(events, selected.id) : [], [events, selected]);
  const checks = useMemo(() => sessionChecks(events, selected?.id ?? ''), [events, selected]);
  const checklist = useMemo(() => checklistSummary(checks), [checks]);
  const selectSession = (id: string | null) => {
    setSelectedId(id);
    setConfirmingAllowId(null);
    if (id) {
      setMobileDetail(true);
      if (discoveredSessions.some((session) => session.session_id === id) && !events.some((event) => event.sessionId === id)) requestDiscoveredHistory(id);
    } else {
      setMobileDetail(false);
    }
  };
  const selectedEvents = useMemo(() => selected && discoveredSessions.some((session) => session.session_id === selected.id) && !events.some((event) => event.sessionId === selected.id)
    ? discoveredHistory[selected.id] ?? []
    : selected ? eventsForSession(events, selected.id) : [], [selected, discoveredHistory, discoveredSessions, events]);
  const selectedItems = useMemo(() => transcriptItems(selectedEvents), [selectedEvents]);
  const items = selectedItems;
  return <main className="main-screen">
    <header className="app-header">
      <div className="brand"><Icon name="shardrail"/><div><h1>Shardrail</h1><p>Local sessions from the daemon journal</p></div></div>
      <div className="header-tools">
        <div className="controls header-controls">
          <StatusPill tone={phase === 'connected' ? 'success' : phase === 'key-changed' ? 'danger' : 'warning'}><Icon className="icon" name={phase === 'connected' ? 'connection' : phase === 'key-changed' ? 'error' : 'reconnect'}/><span className={`connection-state connection-${phase}`} role={phase === 'key-changed' ? 'alert' : 'status'} aria-label={connectionStatusLabel(phase)}><span className="connection-full">{connectionStatusLabel(phase)}</span><span className="connection-short">{phase === 'connected' ? 'Online' : phase === 'key-changed' ? 'Key changed' : 'Reconnecting'}</span></span></StatusPill>
        </div>
        <div className="header-secondary">
          {onUnpair ? <Button className="button-secondary" aria-label="Switch node" onPress={onUnpair}><Icon className="icon" name="close"/><span>Switch node</span></Button> : null}
          <Button className="button-secondary reconnect-button" aria-label="Reconnect" onPress={onReconnect}><Icon className="icon" name="reconnect"/><span>Reconnect</span></Button>
          <ThemeToggle/>
        </div>
      </div>
    </header>
    <HierarchyNav
      machines={machines}
      selectedMachineId={selectedMachineId}
      onSelectMachine={handleSelectMachine}
      agents={agents}
      selectedAgent={selectedAgent}
      onSelectAgent={setSelectedAgent}
      selectedSessionId={selected?.id ?? null}
      onClearSession={() => selectSession(null)}
    />
    <p className="host-banner" role="status">{hostBanner(checks, selected !== null)}</p>
    {keyStorage === 'noble-fallback' ? <p className="inline-note" role="note">This browser stores an extractable private key seed in IndexedDB because non-extractable WebCrypto is unavailable. Same-origin script can read it.</p> : null}
    <div className="workspace">
      <div className={`entry-pane${mobileDetail ? ' mobile-hidden' : ''}`}>
        <EntryArea sessions={agentFilteredSessions} events={events} selectedId={selected?.id ?? null} workdirs={workdirs} pickedWorkdir={pickedWorkdir} createError={createError} createPending={createPending} phase={phase} onSelect={selectSession} onPickWorkdir={setPickedWorkdir} onCreateSession={onCreateSession}/>
      </div>
      <div className={`detail-pane${mobileDetail ? ' mobile-visible' : ''}`}>
        {selected ? <>
          <Button className="button-quiet mobile-back" onPress={() => setMobileDetail(false)}><Icon className="icon" name="back"/> Back to sessions</Button>
          <SessionArea sessionId={selected.id} provider={selected.agentKind} status={selected.status} connected={phase === 'connected'} readOnly={discoveredSessions.some((session) => session.session_id === selected.id) && !events.some((event) => event.sessionId === selected.id)} items={items} approvals={approvals} checklist={checklist} promptError={promptError} promptClear={promptClear} approvalInFlight={approvalInFlight} approvalError={approvalError} confirmingAllowId={confirmingAllowId} onConfirmAllow={setConfirmingAllowId} onResolve={onResolveApproval} onSendPrompt={onSendPrompt} onInterrupt={onInterrupt} onTakeOver={onTakeOver}/>
        </> : <section className="session-detail empty-detail" aria-labelledby="events-heading"><h2 id="events-heading">Sessions</h2><EmptyState><span className="empty-mark"><Icon name="workspace"/></span><strong>{sessions.length === 0 ? 'No sessions yet.' : 'Select a session'}</strong><span>{sessions.length === 0 ? 'Create a session to start monitoring local agent activity.' : 'Choose a session from the list to view its activity, approvals, and verification checks.'}</span></EmptyState></section>}
      </div>
    </div>
  </main>;
}
