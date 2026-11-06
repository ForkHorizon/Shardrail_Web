// Interactive terminal view component rendering ANSI streams and shell prompt input.
import { useEffect, useRef, useState } from 'react';
import { Button, Input, TextField } from 'react-aria-components';
import { parseAnsiSpans } from './ansi-sanitizer';
import { requestTerminalCommand } from '../../browser-session';

export interface TerminalProps {
  sessionId: string;
  provider?: string | null;
  connected: boolean;
  output: string;
  exitCode: number | null;
  onSendInput: (data: string) => void;
  onResize?: (rows: number, cols: number) => void;
  onClear?: () => void;
}

export function TerminalView({
  sessionId,
  provider,
  connected,
  output,
  exitCode,
  onClear,
}: TerminalProps) {
  const [lineInput, setLineInput] = useState('');
  const [stream, setStream] = useState({ output: '', exitCode: null as number | null });
  const screenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const receive = (event: Event) => {
      const frame = (event as CustomEvent<{ kind: string; session_id: string; data?: string; exit_code?: number | null }>).detail;
      if (frame.session_id !== sessionId) return;
      if (frame.kind === 'terminal_output') setStream((state) => ({ ...state, output: (state.output + (frame.data ?? '')).slice(-65536) }));
      if (frame.kind === 'terminal_exited') setStream((state) => ({ ...state, exitCode: frame.exit_code ?? null }));
    };
    window.addEventListener('shardrail-terminal', receive);
    return () => window.removeEventListener('shardrail-terminal', receive);
  }, [sessionId]);

  useEffect(() => {
    if (screenRef.current) {
      screenRef.current.scrollTop = screenRef.current.scrollHeight;
    }
  }, [output, stream.output]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lineInput && lineInput !== '') return;
    requestTerminalCommand('terminal.input', sessionId, { data: lineInput + '\n' });
    setLineInput('');
  };

  const handleInterrupt = () => requestTerminalCommand('terminal.input', sessionId, { data: '\x03' });
  const handleEof = () => requestTerminalCommand('terminal.input', sessionId, { data: '\x04' });
  const handleEnter = () => requestTerminalCommand('terminal.input', sessionId, { data: '\r' });

  const terminalOutput = stream.output || output;
  const terminalExitCode = stream.exitCode ?? exitCode;
  const spans = parseAnsiSpans(terminalOutput);

  return (
    <section className="terminal-view" aria-labelledby="terminal-heading">
      <header className="terminal-toolbar">
        <div className="terminal-meta">
          <h3 id="terminal-heading">Interactive Shell</h3>
          <span className="terminal-tag">{sessionId.slice(0, 8)}</span>
          <span className={`terminal-status-pill status-${connected ? 'online' : 'offline'}`}>
            {connected ? 'Connected' : 'Offline'}
          </span>
          {terminalExitCode !== null ? (
            <span className="terminal-exit-tag">Process exited ({terminalExitCode})</span>
          ) : null}
        </div>
        <div className="terminal-actions">
          <Button className="button-primary terminal-btn" onPress={() => { setStream({ output: '', exitCode: null }); requestTerminalCommand('terminal.spawn', sessionId, { command: provider?.toLowerCase().includes('claude') ? 'claude' : 'codex', args: [] }); }}>Launch agent</Button>
          {
            <Button className="button-secondary terminal-btn" onPress={() => { setStream({ output: '', exitCode: null }); requestTerminalCommand('terminal.attach', sessionId); }}>
              Attach
            </Button>
          }
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
