export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type LinkSegment = {
  type: 'text' | 'link';
  value: string;
};

const linkRegex = /(https?:\/\/[^\s]+)/g;

export const linkify = (text: string): LinkSegment[] => {
  const segments: LinkSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(linkRegex)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        value: text.slice(lastIndex, match.index)
      });
    }
    segments.push({
      type: 'link',
      value: match[0]
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      value: text.slice(lastIndex)
    });
  }

  return segments.length ? segments : [{type: 'text', value: text}];
};
