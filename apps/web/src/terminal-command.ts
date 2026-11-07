// Provider CLI commands used to resume existing local sessions.
export function terminalResumeCommand(provider: string | null, sessionId: string) {
  const agent = provider?.toLowerCase() ?? '';
  if (agent.includes('claude')) return { command: 'claude', args: ['--resume', sessionId] };
  if (agent.includes('codex')) return { command: 'codex', args: ['resume', sessionId] };
  return null;
}

export function sessionIsLocked(status: string) {
  return status.toLowerCase() === 'locked_elsewhere';
}
