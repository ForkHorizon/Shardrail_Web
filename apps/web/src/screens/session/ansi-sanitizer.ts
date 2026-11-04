// Sanitizes ANSI escape sequences and converts color codes into styled HTML spans.
export interface AnsiSpan {
  text: string;
  classes: string;
}

const OSC_PATTERN = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
const ESC_CONTROL_PATTERN = /\x1B[PX^_][^\x1B]*\x1B\\/g;
const CSI_NON_SGR_PATTERN = /\x1B\[[0-9;?]*[@-ln-~]/g;

export function stripUnsafeControls(input: string): string {
  return input
    .replace(OSC_PATTERN, '')
    .replace(ESC_CONTROL_PATTERN, '')
    .replace(CSI_NON_SGR_PATTERN, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/g, '');
}

const COLOR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

function sgrClasses(params: number[]): string {
  const classes: string[] = [];
  for (let i = 0; i < params.length; i++) {
    const code = params[i] ?? 0;
    if (code === 1) classes.push('ansi-bold');
    else if (code === 2) classes.push('ansi-dim');
    else if (code === 4) classes.push('ansi-underline');
    else if (code >= 30 && code <= 37) classes.push(`ansi-fg-${COLOR_NAMES[code - 30]}`);
    else if (code >= 90 && code <= 97) classes.push(`ansi-fg-bright-${COLOR_NAMES[code - 90]}`);
    else if (code >= 40 && code <= 47) classes.push(`ansi-bg-${COLOR_NAMES[code - 40]}`);
    else if (code >= 100 && code <= 107) classes.push(`ansi-bg-bright-${COLOR_NAMES[code - 100]}`);
  }
  return classes.join(' ');
}

export function parseAnsiSpans(input: string): AnsiSpan[] {
  const cleaned = stripUnsafeControls(input);
  const sgrRegex = /\x1B\[([0-9;]*)m/g;
  const spans: AnsiSpan[] = [];
  let currentClasses = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = sgrRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: cleaned.slice(lastIndex, match.index), classes: currentClasses });
    }
    const paramStr = match[1] ?? '';
    const params = paramStr.length === 0 ? [0] : paramStr.split(';').map((p) => parseInt(p, 10) || 0);
    if (params.includes(0)) {
      currentClasses = '';
    } else {
      currentClasses = sgrClasses(params);
    }
    lastIndex = sgrRegex.lastIndex;
  }
  if (lastIndex < cleaned.length) {
    spans.push({ text: cleaned.slice(lastIndex), classes: currentClasses });
  }
  return spans;
}
