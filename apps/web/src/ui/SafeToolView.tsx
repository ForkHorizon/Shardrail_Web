import { useState } from 'react';
import { Button } from 'react-aria-components';
import { StatusPill } from './StatusPill';

export function SafeToolView({
  toolName,
  callId,
  arguments: args,
  output,
  isError,
  status,
  defaultExpanded = false,
}: {
  toolName: string;
  callId?: string | null | undefined;
  arguments?: unknown;
  output?: string | null | undefined;
  isError?: boolean | undefined;
  status?: string | null | undefined;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);

  const formattedArgs = args !== undefined && args !== null
    ? (typeof args === 'string' ? args : JSON.stringify(args, null, 2))
    : null;

  const tone = isError ? 'danger' : status === 'Completed' || status === 'exit 0' ? 'success' : 'neutral';

  return (
    <div className="safe-tool-view" role="region" aria-label={`Tool call: ${toolName}`}>
      <div className="tool-header">
        <Button
          className="tool-toggle"
          aria-expanded={open}
          onPress={() => setOpen(!open)}
        >
          <span className="tool-arrow" aria-hidden="true">{open ? '▼' : '▶'}</span>
          <span className="tool-name">
            <strong>{toolName}</strong>
            {callId && <span className="tool-call-id"> ({callId.slice(0, 10)})</span>}
          </span>
        </Button>
        <div className="tool-meta">
          <StatusPill tone={tone}>{isError ? 'Failed' : status ?? 'Executed'}</StatusPill>
          <span className="tool-untrusted-tag">Untrusted tool payload</span>
        </div>
      </div>
      {open && (
        <div className="tool-details" role="region" aria-label="Tool call arguments and output">
          {formattedArgs && (
            <div className="tool-args-section">
              <span className="section-label">Arguments:</span>
              <pre className="tool-args-pre">{formattedArgs}</pre>
            </div>
          )}
          {output && (
            <div className="tool-output-section">
              <span className="section-label">Output:</span>
              <pre className={`tool-output-pre${isError ? ' error' : ''}`}>{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
