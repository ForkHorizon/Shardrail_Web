import { useState } from 'react';
import { Button } from 'react-aria-components';
import { StatusPill } from './StatusPill';

export function SafeCommandView({
  command,
  cwd,
  exitCode,
  stdout,
  stderr,
  status,
}: {
  command: string;
  cwd?: string | null | undefined;
  exitCode?: number | null | undefined;
  stdout?: string | null | undefined;
  stderr?: string | null | undefined;
  status?: string | null | undefined;
}) {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedOut, setCopiedOut] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const isRunning = exitCode === null && (status === 'running' || !status);
  const isSuccess = exitCode === 0;
  const isFailed = exitCode !== null && exitCode !== 0;

  const handleCopyCmd = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(command).then(() => {
        setCopiedCmd(true);
        setTimeout(() => setCopiedCmd(false), 2000);
      }).catch(() => {});
    }
  };

  const handleCopyOutput = () => {
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard && combined) {
      navigator.clipboard.writeText(combined).then(() => {
        setCopiedOut(true);
        setTimeout(() => setCopiedOut(false), 2000);
      }).catch(() => {});
    }
  };

  const outputText = [
    stdout ? stdout : null,
    stderr ? `[STDERR]\n${stderr}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div className="safe-command-view" role="region" aria-label={`Command: ${command}`}>
      <div className="command-header">
        <div className="command-info">
          <span className="command-prompt-symbol">$</span>
          <code className="command-text" title={command}>{command}</code>
          {cwd && <span className="command-cwd" title={`Working directory: ${cwd}`}>in {cwd}</span>}
        </div>
        <div className="command-status-group">
          {isRunning && <StatusPill tone="warning">Running</StatusPill>}
          {isSuccess && <StatusPill tone="success">Exit 0</StatusPill>}
          {isFailed && <StatusPill tone="danger">{`Exit ${exitCode}`}</StatusPill>}
          <Button
            className="button-secondary button-small copy-cmd-button"
            aria-label="Copy command"
            onPress={handleCopyCmd}
          >
            {copiedCmd ? 'Copied' : 'Copy'}
          </Button>
          {outputText && (
            <Button
              className="button-secondary button-small toggle-output-button"
              aria-label={expanded ? 'Collapse output' : 'Expand output'}
              onPress={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide output' : 'Show output'}
            </Button>
          )}
        </div>
      </div>
      {expanded && outputText && (
        <div className="command-output-box" role="region" aria-label="Command output">
          <div className="output-toolbar">
            <span className="output-label">Untrusted command output</span>
            <Button
              className="button-secondary button-small copy-out-button"
              aria-label="Copy output"
              onPress={handleCopyOutput}
            >
              {copiedOut ? 'Copied' : 'Copy output'}
            </Button>
          </div>
          <pre className="command-output-pre">{outputText}</pre>
        </div>
      )}
    </div>
  );
}
