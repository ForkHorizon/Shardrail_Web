import { Button } from 'react-aria-components';
import { Icon } from './Icon';
import { StatusPill } from './StatusPill';

export type MachineEntry = {
  id: string;
  name: string;
  os?: string;
  arch?: string;
  daemonVersion?: string;
  isOnline?: boolean;
  agentCount?: number;
  sessionCount?: number;
};

export type AgentEntry = {
  name: string;
  label: string;
  form?: 'cli' | 'gui';
  version?: string | null;
  available?: boolean;
  sessionCount?: number;
};

export function HierarchyNav({
  machines,
  selectedMachineId,
  onSelectMachine,
  agents,
  selectedAgent,
  onSelectAgent,
  selectedSessionId,
  onClearSession,
}: {
  machines: readonly MachineEntry[];
  selectedMachineId: string | null;
  onSelectMachine: (id: string | null) => void;
  agents: readonly AgentEntry[];
  selectedAgent: string | null;
  onSelectAgent: (agent: string | null) => void;
  selectedSessionId: string | null;
  onClearSession?: () => void;
}) {
  const currentMachine = machines.find((m) => m.id === selectedMachineId) ?? machines[0] ?? null;
  const currentAgent = agents.find((a) => a.name.toLowerCase() === selectedAgent?.toLowerCase()) ?? null;

  return (
    <nav className="hierarchy-nav" aria-label="Hierarchy navigation">
      <div className="breadcrumb-trail" role="navigation" aria-label="Breadcrumb">
        <ol className="breadcrumb-list">
          <li className="breadcrumb-item">
            <Button
              className="breadcrumb-button"
              aria-label="View all machines"
              onPress={() => {
                onSelectMachine(null);
                onSelectAgent(null);
                onClearSession?.();
              }}
            >
              <Icon className="icon" name="sessions" />
              <span>Machines</span>
            </Button>
          </li>
          {currentMachine && (
            <>
              <li className="breadcrumb-separator" aria-hidden="true">/</li>
              <li className="breadcrumb-item">
                <Button
                  className={`breadcrumb-button${!selectedAgent && !selectedSessionId ? ' current' : ''}`}
                  aria-label={`Machine: ${currentMachine.name}`}
                  onPress={() => {
                    onSelectMachine(currentMachine.id);
                    onSelectAgent(null);
                    onClearSession?.();
                  }}
                >
                  <span className="machine-dot" aria-hidden="true" />
                  <span>{currentMachine.name}</span>
                </Button>
              </li>
            </>
          )}
          {selectedAgent && (
            <>
              <li className="breadcrumb-separator" aria-hidden="true">/</li>
              <li className="breadcrumb-item">
                <Button
                  className={`breadcrumb-button${!selectedSessionId ? ' current' : ''}`}
                  aria-label={`Agent: ${currentAgent?.label ?? selectedAgent}`}
                  onPress={() => {
                    onSelectAgent(selectedAgent);
                    onClearSession?.();
                  }}
                >
                  <Icon className="icon" name="workspace" />
                  <span>{currentAgent?.label ?? selectedAgent}</span>
                </Button>
              </li>
            </>
          )}
          {selectedSessionId && (
            <>
              <li className="breadcrumb-separator" aria-hidden="true">/</li>
              <li className="breadcrumb-item current" aria-current="page">
                <span className="breadcrumb-current-session" title={selectedSessionId}>
                  Session: {selectedSessionId.slice(0, 8)}
                </span>
              </li>
            </>
          )}
        </ol>
      </div>

      <div className="hierarchy-selectors">
        {machines.length > 1 && (
          <div className="machine-selector" role="group" aria-label="Select machine">
            <span className="selector-label">Machine:</span>
            <div className="machine-pills">
              {machines.map((machine) => {
                const active = machine.id === (selectedMachineId ?? machines[0]?.id);
                return (
                  <Button
                    key={machine.id}
                    className={`selector-pill${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onPress={() => onSelectMachine(machine.id)}
                  >
                    <span>{machine.name}</span>
                    <StatusPill tone={machine.isOnline !== false ? 'success' : 'neutral'}>
                      {machine.isOnline !== false ? 'online' : 'offline'}
                    </StatusPill>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <div className="agent-selector" role="group" aria-label="Filter by agent">
          <span className="selector-label">Agent:</span>
          <div className="agent-pills">
            <Button
              className={`selector-pill${selectedAgent === null ? ' active' : ''}`}
              aria-pressed={selectedAgent === null}
              onPress={() => onSelectAgent(null)}
            >
              All Agents
            </Button>
            {agents.map((agent) => {
              const active = selectedAgent?.toLowerCase() === agent.name.toLowerCase();
              return (
                <Button
                  key={agent.name}
                  className={`selector-pill${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onPress={() => onSelectAgent(active ? null : agent.name)}
                >
                  <span>{agent.label}</span>
                  {agent.sessionCount !== undefined && (
                    <span className="pill-badge">{agent.sessionCount}</span>
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
