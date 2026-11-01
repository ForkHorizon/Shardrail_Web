import { useState } from 'react';
import { Button } from 'react-aria-components';
import { StatusPill } from './StatusPill';

export function SafeReasoningView({
  summary,
  content,
  durationMs,
  defaultExpanded = false,
}: {
  summary?: string | null | undefined;
  content: string;
  durationMs?: number | null | undefined;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);

  const durationLabel = durationMs !== undefined && durationMs !== null
    ? `${(durationMs / 1000).toFixed(1)}s`
    : null;

  return (
    <div className="safe-reasoning-view" role="region" aria-label="Agent reasoning">
      <div className="reasoning-header">
        <Button
          className="reasoning-toggle"
          aria-expanded={open}
          onPress={() => setOpen(!open)}
        >
          <span className="reasoning-arrow" aria-hidden="true">{open ? '▼' : '▶'}</span>
          <span className="reasoning-title">
            {summary ? summary : 'Agent reasoning / thought process'}
          </span>
        </Button>
        <div className="reasoning-meta">
          {durationLabel && <StatusPill tone="neutral">{durationLabel}</StatusPill>}
          <span className="reasoning-untrusted-tag">Untrusted internal thought</span>
        </div>
      </div>
      {open && (
        <div className="reasoning-content" role="region" aria-label="Reasoning details">
          <pre className="reasoning-pre">{content}</pre>
        </div>
      )}
    </div>
  );
}
