const NAMED_COLOR_MAP: Record<string, string> = {
  red: '#ff5d5d',
  green: '#79d279',
  blue: '#6aa8ff',
  yellow: '#ffd75f',
  orange: '#ff9f43',
  gray: '#9ba7b8',
  cyan: '#56d7ff',
  purple: '#be8cff',
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const NAME_COLOR_RE = /^#[a-zA-Z]+$/;

type SimpleTag = 'b' | 'u' | 's' | 'h' | 'm';
type TagSpec =
  | {kind: SimpleTag; openParenIndex: number}
  | {kind: 'color'; openParenIndex: number; color: string}
  | {kind: 'invalidColor'; openParenIndex: number};

export function escapeHtml(raw: string) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validateColor(rawColor: string) {
  if (HEX_COLOR_RE.test(rawColor)) return rawColor;
  if (!NAME_COLOR_RE.test(rawColor)) return null;

  const name = rawColor.slice(1).toLowerCase();
  const mapped = NAMED_COLOR_MAP[name];
  if (!mapped) return null;
  return mapped;
}

function tryParseTagSpec(source: string, index: number): TagSpec | null {
  const char = source[index];
  if (!char) return null;

  if ((char === 'b' || char === 'u' || char === 's' || char === 'h' || char === 'm') && source[index + 1] === '(') {
    return {
      kind: char,
      openParenIndex: index + 1,
    };
  }

  if (char !== 'c' || source[index + 1] !== '#') return null;

  let cursor = index + 2;
  while (cursor < source.length && source[cursor] !== '(') {
    const tokenChar = source[cursor];
    if (!/[a-zA-Z0-9]/.test(tokenChar)) {
      return null;
    }
    cursor += 1;
  }

  if (cursor >= source.length || source[cursor] !== '(' || cursor === index + 2) {
    return null;
  }

  const colorRaw = `#${source.slice(index + 2, cursor)}`;
  const color = validateColor(colorRaw);
  if (!color) {
    return {
      kind: 'invalidColor',
      openParenIndex: cursor,
    };
  }

  return {
    kind: 'color',
    color,
    openParenIndex: cursor,
  };
}

function findMatchingParen(source: string, openParenIndex: number) {
  let depth = 1;
  for (let index = openParenIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function renderParsedTag(spec: TagSpec, innerRaw: string) {
  switch (spec.kind) {
    case 'b':
      return `<strong>${renderMessageHtml(innerRaw)}</strong>`;
    case 'u':
      return `<u>${renderMessageHtml(innerRaw)}</u>`;
    case 's':
      return `<s>${renderMessageHtml(innerRaw)}</s>`;
    case 'h':
      return `<span class="message-spoiler">${renderMessageHtml(innerRaw)}</span>`;
    case 'm':
      return `<code>${escapeHtml(innerRaw)}</code>`;
    case 'color':
      return `<span style="color:${spec.color}">${renderMessageHtml(innerRaw)}</span>`;
    case 'invalidColor':
      return escapeHtml(innerRaw);
    default:
      return escapeHtml(innerRaw);
  }
}

function renderMessageHtml(sourceRaw: string) {
  const source = String(sourceRaw || '');
  let result = '';
  let index = 0;

  while (index < source.length) {
    const spec = tryParseTagSpec(source, index);
    if (!spec) {
      result += escapeHtml(source[index]);
      index += 1;
      continue;
    }

    const closeParenIndex = findMatchingParen(source, spec.openParenIndex);
    if (closeParenIndex < 0) {
      result += escapeHtml(source[index]);
      index += 1;
      continue;
    }

    if (spec.kind === 'invalidColor') {
      result += escapeHtml(source.slice(index, closeParenIndex + 1));
      index = closeParenIndex + 1;
      continue;
    }

    const innerRaw = source.slice(spec.openParenIndex + 1, closeParenIndex);
    result += renderParsedTag(spec, innerRaw);
    index = closeParenIndex + 1;
  }

  return result;
}

export function compileMessageFormat(rawTextRaw: unknown) {
  const rawText = String(rawTextRaw ?? '');
  return {
    rawText,
    renderedHtml: renderMessageHtml(rawText),
  };
}
