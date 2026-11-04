// Interactive terminal view component rendering ANSI streams and shell prompt input.
import { useEffect, useRef, useState } from 'react';
import { Button, Input, TextField } from 'react-aria-components';
import { parseAnsiSpans } from './ansi-sanitizer';

export interface TerminalProps {
  sessionId: string;
  connected: boolean;
  output: string;
  exitCode: number | null;
  onSendInput: (data: string) => void;
  onResize?: (rows: number, cols: number) => void;
  onAttach?: () => void;
  onClear?: () => void;
}

export function TerminalView({
  sessionId,
  connected,
  output,
  exitCode,
  onSendInput,
  onAttach,
  onClear,
}: TerminalProps) {
  const [lineInput, setLineInput] = useState('');
  const screenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (screenRef.current) {
      screenRef.current.scrollTop = screenRef.current.scrollHeight;
    }
  }, [output]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lineInput && lineInput !== '') return;
    onSendInput(lineInput + '\n');
    setLineInput('');
  };

  const handleInterrupt = () => onSendInput('\x03');
  const handleEof = () => onSendInput('\x04');
  const handleEnter = () => onSendInput('\r');

  const spans = parseAnsiSpans(output);

  return (
    <section className="terminal-view" aria-labelledby="terminal-heading">
      <header className="terminal-toolbar">
        <div className="terminal-meta">
          <h3 id="terminal-heading">Interactive Shell</h3>
          <span className="terminal-tag">{sessionId.slice(0, 8)}</span>
          <span className={`terminal-status-pill status-${connected ? 'online' : 'offline'}`}>
            {connected ? 'Connected' : 'Offline'}
          </span>
          {exitCode !== null ? (
            <span className="terminal-exit-tag">Process exited ({exitCode})</span>
          ) : null}
        </div>
        <div className="terminal-actions">
          {onAttach ? (
            <Button className="button-secondary terminal-btn" onPress={onAttach}>
              Attach
            </Button>
          ) : null}
          {onClear ? (
            <Button className="button-secondary terminal-btn" onPress={onClear}>
              Clear
            </Button>
          ) : null}
          <Button className="button-secondary terminal-btn" onPress={handleInterrupt} aria-label="Send SIGINT (Ctrl+C)">
            ^C
          </Button>
          <Button className="button-secondary terminal-btn" onPress={handleEof} aria-label="Send EOF (Ctrl+D)">
            ^D
          </Button>
        </div>
      </header>

      <div
        ref={screenRef}
        className="terminal-screen"
        role="region"
        aria-label="Terminal output stream"
        tabIndex={0}
      >
        {spans.length === 0 ? (
          <span className="terminal-empty">Terminal ready. Type a command or attach to the agent process.</span>
        ) : (
          <pre className="terminal-pre">
            {spans.map((span, idx) => (
              <span key={idx} className={span.classes || undefined}>
                {span.text}
              </span>
            ))}
          </pre>
        )}
      </div>

      <form className="terminal-prompt-form" onSubmit={handleSubmit}>
        <TextField aria-label="Terminal input" className="terminal-input-field" value={lineInput} onChange={setLineInput}>
          <Input placeholder="Type command..." className="terminal-input" autoFocus disabled={!connected} />
        </TextField>
        <Button type="submit" className="button-primary terminal-submit" isDisabled={!connected} onPress={handleEnter}>
          Send
        </Button>
      </form>
    </section>
  );
}
