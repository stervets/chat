import {randomBytes} from 'node:crypto';

const MAX_RESERVE_CHUNK_TEXT_LIMIT_DEFAULT = 3000;
const MAX_CHUNKS_PER_PACKET = 100;
const INCOMPLETE_TTL_MS = 2 * 60 * 1000;
const CHUNK_ID_BYTES = 6;

type AtomicData = {
  kind: 'atomic';
  payload: string;
};

type ChunkData = {
  kind: 'chunk';
  chunkId: string;
  index: number;
  total: number;
  part: string;
};

type ParsedMaxReserveData = AtomicData | ChunkData;

type BuiltMaxReserveText = {
  text: string;
  kind: 'atomic' | 'chunk';
  chunkId?: string;
  index?: number;
  total?: number;
};

type ChunkBucket = {
  recipientId: string;
  chunkId: string;
  total: number;
  createdAtMs: number;
  parts: Array<string | null>;
  receivedCount: number;
};

function toBase64Url(value: Buffer) {
  return value.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function clampChunkTextLimit(limitRaw: number) {
  const limit = Number(limitRaw || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return MAX_RESERVE_CHUNK_TEXT_LIMIT_DEFAULT;
  }
  return Math.max(512, Math.min(12000, Math.floor(limit)));
}

function nextChunkId() {
  return toBase64Url(randomBytes(CHUNK_ID_BYTES));
}

function hasColonOrWhitespace(valueRaw: string) {
  const value = String(valueRaw || '');
  return value.includes(':') || /\s/.test(value);
}

function buildChunkPrefix(recipientId: string, chunkId: string, index: number, total: number) {
  return `${recipientId} C:${chunkId}:${index}:${total}:`;
}

function buildAtomicText(recipientId: string, payload: string) {
  return `${recipientId} A:${payload}`;
}

export function buildMaxReserveTextFrames(recipientIdRaw: string, payloadRaw: string, limitRaw = MAX_RESERVE_CHUNK_TEXT_LIMIT_DEFAULT): BuiltMaxReserveText[] {
  const recipientId = String(recipientIdRaw || '').trim();
  const payload = String(payloadRaw || '');
  if (!recipientId || !payload) return [];

  const limit = clampChunkTextLimit(limitRaw);
  const atomic = buildAtomicText(recipientId, payload);
  if (atomic.length <= limit) {
    return [{text: atomic, kind: 'atomic'}];
  }

  const chunkId = nextChunkId();
  if (hasColonOrWhitespace(chunkId)) {
    throw new Error('reserve_chunk_invalid_chunk_id');
  }

  const maxPrefix = buildChunkPrefix(recipientId, chunkId, MAX_CHUNKS_PER_PACKET - 1, MAX_CHUNKS_PER_PACKET);
  const partSize = limit - maxPrefix.length;
  if (partSize <= 0) {
    throw new Error('reserve_chunk_limit_too_small');
  }

  const total = Math.ceil(payload.length / partSize);
  if (!Number.isFinite(total) || total <= 1) {
    throw new Error('reserve_chunk_invalid_total');
  }
  if (total > MAX_CHUNKS_PER_PACKET) {
    throw new Error('reserve_chunk_total_too_large');
  }

  const result: BuiltMaxReserveText[] = [];
  for (let index = 0; index < total; index += 1) {
    const start = index * partSize;
    const end = start + partSize;
    const part = payload.slice(start, end);
    const text = `${buildChunkPrefix(recipientId, chunkId, index, total)}${part}`;
    if (text.length > limit) {
      throw new Error('reserve_chunk_limit_overflow');
    }
    result.push({
      text,
      kind: 'chunk',
      chunkId,
      index,
      total,
    });
  }

  return result;
}

export function parseMaxReserveData(dataRaw: string): ParsedMaxReserveData | null {
  const data = String(dataRaw || '').trim();
  if (!data) return null;

  if (data.startsWith('A:')) {
    const payload = data.slice(2);
    if (!payload) return null;
    return {kind: 'atomic', payload};
  }

  if (data.startsWith('C:')) {
    const body = data.slice(2);
    const first = body.indexOf(':');
    const second = first < 0 ? -1 : body.indexOf(':', first + 1);
    const third = second < 0 ? -1 : body.indexOf(':', second + 1);
    if (first <= 0 || second <= first + 1 || third <= second + 1) {
      return null;
    }

    const chunkId = body.slice(0, first).trim();
    const indexText = body.slice(first + 1, second).trim();
    const totalText = body.slice(second + 1, third).trim();
    const part = body.slice(third + 1);
    if (!chunkId || !indexText || !totalText || !part) {
      return null;
    }
    if (hasColonOrWhitespace(chunkId)) {
      return null;
    }

    const index = Number.parseInt(indexText, 10);
    const total = Number.parseInt(totalText, 10);
    if (!Number.isFinite(index) || !Number.isFinite(total)) {
      return null;
    }

    return {
      kind: 'chunk',
      chunkId,
      index,
      total,
      part,
    };
  }

  return {kind: 'atomic', payload: data};
}

export class MaxChunkAssembler {
  private readonly buckets = new Map<string, ChunkBucket>();

  private cleanup(nowMs: number) {
    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.createdAtMs > INCOMPLETE_TTL_MS) {
        this.buckets.delete(key);
      }
    }
  }

  push(recipientIdRaw: string, chunk: ChunkData, nowMs = Date.now()) {
    const recipientId = String(recipientIdRaw || '').trim();
    if (!recipientId) return null;

    this.cleanup(nowMs);

    const {chunkId, index, total, part} = chunk;
    if (!chunkId || hasColonOrWhitespace(chunkId)) return null;
    if (!Number.isFinite(total) || total <= 1 || total > MAX_CHUNKS_PER_PACKET) return null;
    if (!Number.isFinite(index) || index < 0 || index >= total) return null;
    if (!part) return null;

    const key = `${recipientId}:${chunkId}`;
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.total !== total) {
      bucket = {
        recipientId,
        chunkId,
        total,
        createdAtMs: nowMs,
        parts: Array.from({length: total}, () => null),
        receivedCount: 0,
      };
      this.buckets.set(key, bucket);
    }

    if (bucket.parts[index] === null) {
      bucket.receivedCount += 1;
    }
    bucket.parts[index] = part;

    if (bucket.receivedCount < bucket.total) {
      return null;
    }

    const fullPayload = bucket.parts.join('');
    this.buckets.delete(key);
    return fullPayload;
  }
}

export {
  MAX_CHUNKS_PER_PACKET,
  MAX_RESERVE_CHUNK_TEXT_LIMIT_DEFAULT,
};

export type {
  BuiltMaxReserveText,
  ChunkData,
  ParsedMaxReserveData,
};
