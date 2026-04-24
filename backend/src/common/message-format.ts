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
const URL_RE = /https?:\/\/[^\s]+/gi;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;

type SimpleTag = 'b' | 'u' | 's' | 'h' | 'm';
type TagSpec =
  | {kind: SimpleTag; openParenIndex: number}
  | {kind: 'color'; openParenIndex: number; color: string}
  | {kind: 'invalidColor'; openParenIndex: number};

type LinkChunk = {
  type: 'text' | 'link';
  value: string;
};

export type MessageLinkPreview = {
  key: string;
  type: 'image' | 'video' | 'embed' | 'youtube';
  src: string;
  href?: string;
};

export type MessageMentionTarget = {
  nickname: string;
  name: string;
  nicknameColor: string | null;
};

export type MessageTimeReferenceTarget = {
  messageId: number;
  tooltip: string;
};

export type CompileMessageFormatOptions = {
  resolveMention?: (nickname: string) => MessageMentionTarget | null;
  resolveTimeReference?: (timeLabel: string) => MessageTimeReferenceTarget | null;
};

export type MessageFormatTokens = {
  mentionNicknames: string[];
  timeLabels: string[];
};

function safeNicknameColor(raw: unknown) {
  const value = String(raw || '').trim();
  if (!HEX_COLOR_RE.test(value)) return '';
  return value.toLowerCase();
}

export function escapeHtml(raw: unknown) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(raw: unknown) {
  return String(raw || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&');
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
      return `<strong>${renderFormattedHtml(innerRaw)}</strong>`;
    case 'u':
      return `<u>${renderFormattedHtml(innerRaw)}</u>`;
    case 's':
      return `<s>${renderFormattedHtml(innerRaw)}</s>`;
    case 'h':
      return `<span class="message-spoiler">${renderFormattedHtml(innerRaw)}</span>`;
    case 'm':
      return `<code>${escapeHtml(innerRaw)}</code>`;
    case 'color':
      return `<span style="color:${spec.color}">${renderFormattedHtml(innerRaw)}</span>`;
    case 'invalidColor':
      return escapeHtml(innerRaw);
    default:
      return escapeHtml(innerRaw);
  }
}

function renderFormattedHtml(sourceRaw: string) {
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

function normalizeMessageLink(rawUrl: string) {
  return String(rawUrl || '').replace(/[),.;!?]+$/g, '');
}

function parseHttpUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractYouTubeId(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host.includes('youtu.be')) {
    const id = url.pathname.split('/').filter(Boolean)[0] || '';
    return id || null;
  }
  if (!host.includes('youtube.com')) return null;

  if (url.pathname.startsWith('/watch')) {
    const id = url.searchParams.get('v') || '';
    return id || null;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'shorts' || parts[0] === 'embed') {
    return parts[1] || null;
  }
  return null;
}

function extractVkVideo(url: URL) {
  const host = url.hostname.toLowerCase();
  if (!host.includes('vkvideo.ru') && !host.includes('vk.com')) return null;

  const joined = `${url.pathname}${url.search}`;
  const match = joined.match(/video(-?\d+)_([0-9]+)/i);
  if (!match) return null;

  return {
    oid: match[1],
    id: match[2],
  };
}

function extractRutubeVideo(url: URL) {
  const host = url.hostname.toLowerCase();
  if (!host.includes('rutube.ru')) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'video') return null;
  const id = String(parts[1] || '').trim();
  if (!id || !/^[a-zA-Z0-9]+$/.test(id)) return null;
  return id;
}

export function buildLinkPreview(linkUrlRaw: unknown): MessageLinkPreview | null {
  const linkUrl = String(linkUrlRaw || '').trim();
  if (!linkUrl) return null;

  const url = parseHttpUrl(linkUrl);
  if (!url) return null;

  const path = url.pathname.toLowerCase();
  if (IMAGE_EXT_RE.test(path)) {
    return {
      key: `img:${linkUrl}`,
      type: 'image',
      src: linkUrl,
    };
  }

  if (VIDEO_EXT_RE.test(path)) {
    return {
      key: `video:${linkUrl}`,
      type: 'video',
      src: linkUrl,
    };
  }

  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return {
      key: `yt:${youtubeId}`,
      type: 'youtube',
      src: `https://www.youtube.com/embed/${youtubeId}`,
    };
  }

  const vkVideo = extractVkVideo(url);
  if (vkVideo) {
    return {
      key: `vk:${vkVideo.oid}_${vkVideo.id}`,
      type: 'embed',
      src: `https://vk.com/video_ext.php?oid=${vkVideo.oid}&id=${vkVideo.id}&hd=2`,
    };
  }

  const rutubeId = extractRutubeVideo(url);
  if (rutubeId) {
    return {
      key: `rutube:${rutubeId}`,
      type: 'embed',
      src: `https://rutube.ru/play/embed/${rutubeId}`,
    };
  }

  return null;
}

export function extractMessageLinks(bodyRaw: unknown) {
  const body = String(bodyRaw || '');
  URL_RE.lastIndex = 0;
  const matches = body.match(URL_RE) || [];
  return matches
    .map((url) => normalizeMessageLink(url))
    .map((url) => String(url || '').trim())
    .filter(Boolean);
}

export function buildMessagePreviews(rawTextRaw: unknown) {
  const previews: MessageLinkPreview[] = [];
  const seen = new Set<string>();

  for (const linkUrl of extractMessageLinks(rawTextRaw)) {
    const preview = buildLinkPreview(linkUrl);
    if (!preview) continue;
    if (seen.has(preview.key)) continue;
    seen.add(preview.key);
    previews.push(preview);
  }

  return previews;
}

function splitTextToLinks(rawTextRaw: unknown): LinkChunk[] {
  const rawText = String(rawTextRaw || '');
  const chunks: LinkChunk[] = [];
  let lastIndex = 0;

  URL_RE.lastIndex = 0;
  for (const match of rawText.matchAll(URL_RE)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      chunks.push({
        type: 'text',
        value: rawText.slice(lastIndex, match.index),
      });
    }
    chunks.push({
      type: 'link',
      value: String(match[0] || ''),
    });
    lastIndex = match.index + String(match[0] || '').length;
  }

  if (lastIndex < rawText.length) {
    chunks.push({
      type: 'text',
      value: rawText.slice(lastIndex),
    });
  }

  if (!chunks.length) {
    return [{type: 'text', value: rawText}];
  }
  return chunks;
}

function renderTextChunkHtml(rawChunkRaw: unknown, options: CompileMessageFormatOptions) {
  const chunks = splitTextToLinks(rawChunkRaw);
  let html = '';

  for (const chunk of chunks) {
    if (chunk.type === 'link') {
      const normalizedUrl = normalizeMessageLink(chunk.value);
      const parsedUrl = parseHttpUrl(normalizedUrl);
      if (!parsedUrl) {
        html += escapeHtml(chunk.value);
        continue;
      }

      const escapedUrl = escapeHtml(normalizedUrl);
      const preview = buildLinkPreview(normalizedUrl);
      if (preview?.type === 'image') {
        html += `<a class="inline-image-link" href="${escapedUrl}" target="_blank" rel="noopener noreferrer"><img class="preview-media preview-image preview-inline-image" src="${escapedUrl}" alt="image preview" loading="lazy" decoding="async"></a>`;
      } else {
        html += `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`;
      }
      continue;
    }

    const text = String(chunk.value || '');
    const tokenRe = /@([a-zA-Z0-9._-]+)|\[(\d{2}:\d{2}:\d{2})\]/g;
    let lastIndex = 0;

    for (const match of text.matchAll(tokenRe)) {
      if (match.index === undefined) continue;
      if (match.index > lastIndex) {
        html += escapeHtml(text.slice(lastIndex, match.index));
      }

      if (match[1]) {
        const rawNickname = String(match[1] || '').trim();
        const nickname = rawNickname.toLowerCase();
        const mention = options.resolveMention?.(nickname) || null;
        if (!mention) {
          html += escapeHtml(`@${rawNickname}`);
        } else {
          const mentionUsername = `@${mention.nickname}`;
          const escapedUsername = escapeHtml(mentionUsername);
          const escapedName = escapeHtml(mention.name);
          const color = safeNicknameColor(mention.nicknameColor);
          const style = color ? ` style="color:${color}"` : '';
          html += `<span class="mention-token" data-mention="${escapedUsername}" title="${escapedUsername}"${style}>${escapedName}</span>`;
        }
      } else {
        const timeLabel = String(match[2] || '').trim();
        const timeTarget = options.resolveTimeReference?.(timeLabel) || null;
        const tooltip = timeTarget?.tooltip || 'Сообщение с этим временем не найдено';
        const targetAttr = timeTarget?.messageId ? ` data-target-message-id="${timeTarget.messageId}"` : '';
        html += `<span class="time-reference" data-time-tooltip="${escapeHtml(tooltip)}"${targetAttr}>[${escapeHtml(timeLabel)}]</span>`;
      }

      lastIndex = match.index + String(match[0] || '').length;
    }

    if (lastIndex < text.length) {
      html += escapeHtml(text.slice(lastIndex));
    }
  }

  return html;
}

function decorateRenderedHtml(sourceHtmlRaw: unknown, options: CompileMessageFormatOptions) {
  const sourceHtml = String(sourceHtmlRaw || '');
  if (!sourceHtml) return '';

  let html = '';
  let index = 0;
  let insideCode = false;

  while (index < sourceHtml.length) {
    if (sourceHtml[index] === '<') {
      const closeIndex = sourceHtml.indexOf('>', index);
      if (closeIndex < 0) {
        html += escapeHtml(decodeHtmlEntities(sourceHtml.slice(index)));
        break;
      }

      const tag = sourceHtml.slice(index, closeIndex + 1);
      const tagLower = tag.toLowerCase();
      if (tagLower === '<code>') insideCode = true;
      if (tagLower === '</code>') insideCode = false;
      html += tag;
      index = closeIndex + 1;
      continue;
    }

    const nextTagIndex = sourceHtml.indexOf('<', index);
    const chunk = nextTagIndex < 0
      ? sourceHtml.slice(index)
      : sourceHtml.slice(index, nextTagIndex);

    if (insideCode) {
      html += chunk;
    } else {
      html += renderTextChunkHtml(decodeHtmlEntities(chunk), options);
    }

    if (nextTagIndex < 0) break;
    index = nextTagIndex;
  }

  return html;
}

export function extractMessageFormatTokens(rawTextRaw: unknown): MessageFormatTokens {
  const rawText = String(rawTextRaw || '');
  const mentionNicknames = new Set<string>();
  const timeLabels = new Set<string>();

  for (const match of rawText.matchAll(/@([a-zA-Z0-9._-]+)/g)) {
    const nickname = String(match[1] || '').trim().toLowerCase();
    if (nickname) {
      mentionNicknames.add(nickname);
    }
  }

  for (const match of rawText.matchAll(/\[(\d{2}:\d{2}:\d{2})\]/g)) {
    const timeLabel = String(match[1] || '').trim();
    if (timeLabel) {
      timeLabels.add(timeLabel);
    }
  }

  return {
    mentionNicknames: Array.from(mentionNicknames),
    timeLabels: Array.from(timeLabels),
  };
}

export function compileMessageFormat(rawTextRaw: unknown, options: CompileMessageFormatOptions = {}) {
  const rawText = String(rawTextRaw ?? '');
  const formattedHtml = renderFormattedHtml(rawText);
  const renderedHtml = decorateRenderedHtml(formattedHtml, options);
  const renderedPreviews = buildMessagePreviews(rawText);

  return {
    rawText,
    renderedHtml,
    renderedPreviews,
  };
}
