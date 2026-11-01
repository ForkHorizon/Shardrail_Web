import { useState } from 'react';
import { Button } from 'react-aria-components';
import { Icon } from './Icon';
import { StatusPill } from './StatusPill';

export type DiffLineType = 'add' | 'del' | 'hunk' | 'header' | 'context';

export type ParsedDiffLine = {
  type: DiffLineType;
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export function parseUnifiedDiff(diffText: string): ParsedDiffLine[] {
  const lines = diffText.split(/\r?\n/);
  const result: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'header', text: line });
    } else if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match && match[1] && match[2]) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', text: line.slice(1), newLineNumber: newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      result.push({ type: 'del', text: line.slice(1), oldLineNumber: oldLine });
      oldLine += 1;
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line;
      result.push({ type: 'context', text, oldLineNumber: oldLine, newLineNumber: newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return result;
}

export function SafeDiffView({
  path,
  action = 'modified',
  diff,
}: {
  path: string;
  action?: 'created' | 'modified' | 'deleted' | string;
  diff: string;
}) {
  const [copied, setCopied] = useState(false);
  const parsedLines = parseUnifiedDiff(diff);
  const additions = parsedLines.filter((l) => l.type === 'add').length;
  const deletions = parsedLines.filter((l) => l.type === 'del').length;

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(diff).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  const actionTone = action === 'created' ? 'success' : action === 'deleted' ? 'danger' : 'neutral';

  return (
    <div className="safe-diff-view" role="region" aria-label={`Diff for ${path}`}>
      <div className="diff-header">
        <div className="diff-title">
          <Icon className="icon" name="workspace" />
          <span className="diff-path" title={path}>{path}</span>
          <StatusPill tone={actionTone}>{action}</StatusPill>
        </div>
        <div className="diff-stats">
          {additions > 0 && <span className="stat-add">+{additions}</span>}
          {deletions > 0 && <span className="stat-del">-{deletions}</span>}
          <Button
            className="button-secondary button-small copy-diff-button"
            aria-label="Copy diff"
            onPress={handleCopy}
          >
            {copied ? 'Copied' : 'Copy diff'}
          </Button>
        </div>
      </div>
      <div className="diff-body" role="region" aria-label={`Diff content for ${path}`}>
        <pre className="diff-pre">
          {parsedLines.map((line, idx) => (
            <div key={idx} className={`diff-line diff-line-${line.type}`}>
              <span className="diff-gutter diff-gutter-old">
                {line.oldLineNumber !== undefined ? line.oldLineNumber : ''}
              </span>
              <span className="diff-gutter diff-gutter-new">
                {line.newLineNumber !== undefined ? line.newLineNumber : ''}
              </span>
              <span className="diff-marker">
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'hunk' ? '@@' : ' '}
              </span>
              <span className="diff-text">{line.text}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
