import { useMemo, useState } from 'react';
import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components';
import { activityTimestamp, checklistSummary, sessionChecks, type JournalEvent, type SessionSummary } from '../../session-model';
import { EmptyState } from '../../ui/EmptyState';
import { InlineAlert } from '../../ui/InlineAlert';
import { Icon } from '../../ui/Icon';
import { StatusPill } from '../../ui/StatusPill';
import { SessionFilterBar } from '../../ui/SessionFilterBar';
import type { ConnectionPhase } from '../../browser-session';

export function EntryArea({ sessions, events, selectedId, workdirs, pickedWorkdir, createError, createPending, phase, onSelect, onPickWorkdir, onCreateSession }: {
  sessions: readonly SessionSummary[];
  events: readonly JournalEvent[];
  selectedId: string | null;
  workdirs: readonly string[] | null;
  pickedWorkdir: string;
  createError: string | null;
  createPending: boolean;
  phase: ConnectionPhase;
  onSelect: (sessionId: string | null) => void;
  onPickWorkdir: (workdir: string) => void;
  onCreateSession: (workdir: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');

  const selectedWorkdir = workdirs?.includes(pickedWorkdir) ? pickedWorkdir : (workdirs?.[0] ?? '');

  const filteredSessions = useMemo(() => {
    let result = [...sessions];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((s) =>
        s.id.toLowerCase().includes(q) ||
        (s.label && s.label.toLowerCase().includes(q)) ||
        (s.agentKind && s.agentKind.toLowerCase().includes(q)) ||
        (s.workdir && s.workdir.toLowerCase().includes(q)) ||
        (s.model && s.model.toLowerCase().includes(q)) ||
        s.status.toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'open') {
      result = result.filter((s) => s.lifecycle === 'active' || s.lifecycle === 'open' || s.status.toLowerCase().includes('running') || s.status.toLowerCase().includes('active'));
    } else if (statusFilter === 'closed') {
      result = result.filter((s) => s.lifecycle === 'closed' || s.lifecycle === 'completed' || s.lifecycle === 'failed' || s.status.toLowerCase().includes('exit') || s.status.toLowerCase().includes('completed') || s.status.toLowerCase().includes('closed'));
    }

    if (sortBy === 'newest') {
      result.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
    } else if (sortBy === 'oldest') {
      result.sort((a, b) => a.lastActivityMs - b.lastActivityMs);
    } else if (sortBy === 'name') {
      result.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
    }
    return result;
  }, [sessions, searchQuery, statusFilter, sortBy]);

  return <section className="session-column" aria-labelledby="sessions-heading">
    <div className="entry-heading"><div><p className="eyebrow">WORKSPACES</p><h2 id="sessions-heading"><Icon className="icon" name="sessions"/> Sessions <span className="session-count">{filteredSessions.length}{filteredSessions.length !== sessions.length ? ` / ${sessions.length}` : ''}</span></h2></div></div>
    {workdirs !== null ? <section className="new-session" aria-label="New session">
      <Select aria-label="Workdir" selectedKey={selectedWorkdir || null} onSelectionChange={(key) => onPickWorkdir(String(key ?? ''))} isDisabled={workdirs.length === 0}>
        <Label>Workdir</Label><Button className="field-control"><SelectValue>{workdirs.length === 0 ? 'No workdir reported' : undefined}</SelectValue><span aria-hidden="true">⌄</span></Button>
        <Popover><ListBox>{workdirs.map((dir) => <ListBoxItem key={dir} id={dir} textValue={dir}>{dir}</ListBoxItem>)}</ListBox></Popover>
      </Select>
      <Button className="create-session-button" isDisabled={selectedWorkdir.length === 0 || createPending || phase !== 'connected'} onPress={() => onCreateSession(selectedWorkdir)}>{createPending ? <><span className="state-spinner" aria-hidden="true"/>{phase === 'connected' ? 'Creating session…' : 'Checking session creation…'}</> : 'New session'}</Button>
      {createPending ? <p className="create-pending" role="status">{phase === 'connected' ? 'Waiting for the daemon to confirm the new session.' : 'Connection interrupted. Reconnect to learn whether the session was created.'}</p> : null}
      {workdirs.length === 0 ? <p className="field-help">No available workdirs were reported by the daemon.</p> : null}
      {phase !== 'connected' && workdirs.length > 0 ? <p className="field-help">Reconnect to the daemon before creating a session.</p> : null}
      {createError ? <InlineAlert>{createError}</InlineAlert> : null}
    </section> : phase === 'connected' ? <div className="permission-state"><Icon className="icon" name="warning"/><p><strong>Session creation unavailable</strong><span>This browser does not have the <code>session.create</code> permission.</span></p></div> : <div className="session-loading" role="status"><span className="state-spinner" aria-hidden="true"/><span>Loading available workdirs…</span></div>}
    {sessions.length > 0 ? <SessionFilterBar
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      statusFilter={statusFilter}
      onStatusFilterChange={(s) => setStatusFilter((s as 'all' | 'open' | 'closed') ?? 'all')}
      sortBy={sortBy}
      onSortChange={setSortBy}
      onResetFilters={() => { setSearchQuery(''); setStatusFilter('all'); }}
      totalCount={sessions.length}
      filteredCount={filteredSessions.length}
    /> : null}
    {sessions.length === 0 && phase === 'connecting' ? <div className="session-skeleton" role="status" aria-label="Loading sessions"><span/><span/><span/></div> : sessions.length === 0 ? null : filteredSessions.length === 0 ? <div className="session-filter-empty" role="status"><p>No sessions match the current filters.</p><Button className="button-quiet" onPress={() => { setSearchQuery(''); setStatusFilter('all'); }}>Reset filters</Button></div> : <ListBox className="session-list" aria-label="Sessions" selectionMode="single" selectedKeys={selectedId ? [selectedId] : []} onSelectionChange={(keys) => { if (keys === 'all') return; onSelect([...keys][0] == null ? null : String([...keys][0])); }}>
      {filteredSessions.map((session) => {
        const row = checklistSummary(sessionChecks(events, session.id));
        const activity = activityTimestamp(session.lastActivityMs);
        return <ListBoxItem className="session-option" key={session.id} id={session.id} textValue={`${session.id} ${session.agentKind ?? 'agent unknown'} ${session.status} ${row.unverified} not verified`} onFocus={() => onSelect(session.id)}>
          <span className="session-row-heading"><span className="session-id" title={session.id}>{session.label || session.id}</span><StatusPill tone="neutral">{session.lifecycle}</StatusPill></span>
          <span className="session-provider"><Icon className="icon" name="workspace"/>{session.agentKind ?? 'Agent unknown'}{session.model ? ` · ${session.model}` : ''}</span>
          {session.workdir ? <span className="session-workdir" title={session.workdir}>{session.workdir}</span> : null}
          <span className="session-meta"><span>{session.status} · {row.unverified} checks not verified</span>{activity ? <time dateTime={activity}>{new Date(session.lastActivityMs).toLocaleString()}</time> : <time>no activity yet</time>}</span>
        </ListBoxItem>;
      })}
    </ListBox>}
    {filteredSessions.length === 0 && sessions.length > 0 ? (
      <div className="session-filter-empty" role="status">
        <p>No sessions match the selected filters</p>
      </div>
    ) : null}
    {sessions.length === 0 && phase !== 'connecting' ? <div className="phone-empty-state"><EmptyState><span className="empty-mark"><Icon name="workspace"/></span><strong>No sessions yet.</strong><span>Create a session to start monitoring local agent activity.</span></EmptyState></div> : null}
  </section>;
}
