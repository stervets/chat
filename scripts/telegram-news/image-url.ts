const TELEGRAM_HTML_TIMEOUT_MS = 8000;
const TELEGRAM_HTML_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function decodeHtmlEntities(raw: string) {
  return String(raw || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeImageUrl(raw: string, pageUrl: string) {
  const decoded = decodeHtmlEntities(raw).trim();
  if (!decoded) return null;

  let value = decoded
    .replace(/^url\((.*)\)$/i, '$1')
    .trim()
    .replace(/^['"]/, '')
    .replace(/['"]$/, '');

  if (!value || value.startsWith('data:')) return null;
  if (value.startsWith('//')) value = `https:${value}`;

  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return null;
  }
}

function extractBackgroundImageFromTag(tag: string, pageUrl: string) {
  const styleMatch = tag.match(/\sstyle=(['"])(.*?)\1/i);
  if (!styleMatch) return null;

  const style = String(styleMatch[2] || '');
  const bgMatch = style.match(/background-image\s*:\s*url\((['"]?)([^'"\)]+)\1\)/i);
  if (!bgMatch) return null;

  return normalizeImageUrl(bgMatch[2], pageUrl);
}

function extractFromTelegramBlocks(html: string, pageUrl: string) {
  const blockPatterns = [
    /<[^>]*class=['"][^'"]*tgme_widget_message_photo_wrap[^'"]*['"][^>]*>/gi,
    /<[^>]*class=['"][^'"]*tgme_widget_message_link_preview_image[^'"]*['"][^>]*>/gi,
    /<[^>]*class=['"][^'"]*tgme_widget_message_video_thumb[^'"]*['"][^>]*>/gi,
  ];

  for (const blockPattern of blockPatterns) {
    let match: RegExpExecArray | null;
    while ((match = blockPattern.exec(html)) !== null) {
      const extracted = extractBackgroundImageFromTag(match[0], pageUrl);
      if (extracted) return extracted;
    }
  }

  return null;
}

function extractFromOgImageMeta(html: string, pageUrl: string) {
  const ogMatch = html.match(/<meta[^>]*property=['"]og:image['"][^>]*content=['"]([^'"]+)['"][^>]*>/i);
  if (!ogMatch) return null;
  return normalizeImageUrl(ogMatch[1], pageUrl);
}

function extractFromAnyBackgroundImage(html: string, pageUrl: string) {
  const bgMatch = html.match(/background-image\s*:\s*url\((['"]?)([^'"\)]+)\1\)/i);
  if (!bgMatch) return null;
  return normalizeImageUrl(bgMatch[2], pageUrl);
}

export function extractTelegramPostImageUrlFromHtml(htmlRaw: string, pageUrl: string) {
  const html = String(htmlRaw || '');
  if (!html) return null;

  const fromBlocks = extractFromTelegramBlocks(html, pageUrl);
  if (fromBlocks) return fromBlocks;

  const fromAnyBackground = extractFromAnyBackgroundImage(html, pageUrl);
  if (fromAnyBackground) return fromAnyBackground;

  return extractFromOgImageMeta(html, pageUrl);
}

export async function fetchTelegramPostImageUrl(postUrl: string) {
  try {
    const response = await fetch(postUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TELEGRAM_HTML_TIMEOUT_MS),
      headers: {
        'user-agent': TELEGRAM_HTML_USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) return null;
    const html = await response.text();
    return extractTelegramPostImageUrlFromHtml(html, postUrl);
  } catch {
    return null;
  }
}
