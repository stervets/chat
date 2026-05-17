import assert from 'node:assert/strict';
import {
  buildMaxReserveTextFrames as buildBackendFrames,
  MaxChunkAssembler as BackendAssembler,
  parseMaxReserveData as parseBackendData,
} from '../backend/src/ws/max-reserve-chunk-codec.ts';
import {
  buildMaxReserveTextFrames as buildFrontendFrames,
  MaxChunkAssembler as FrontendAssembler,
  parseMaxReserveData as parseFrontendData,
} from '../frontend/src/composables/classes/max-reserve-chunk-codec.ts';

type CodecSuite = {
  buildFrames: (recipientId: string, payload: string, limit: number) => Array<{
    text: string;
    kind: 'atomic' | 'chunk';
    chunkId?: string;
    index?: number;
    total?: number;
  }>;
  parseData: (data: string) => {
    kind: 'atomic' | 'chunk';
    payload?: string;
    chunkId?: string;
    index?: number;
    total?: number;
    part?: string;
  } | null;
  createAssembler: () => {
    push: (recipientId: string, chunk: {chunkId: string; index: number; total: number; part: string}) => string | null;
  };
};

const LIMIT = 3000;

function parseText(text: string) {
  const sep = text.indexOf(' ');
  assert.ok(sep > 0, 'invalid text frame format');
  return {
    recipientId: text.slice(0, sep),
    data: text.slice(sep + 1),
  };
}

function runSuite(label: string, suite: CodecSuite) {
  const recipient = '34';
  const shortPayload = 'abc123';
  const shortFrames = suite.buildFrames(recipient, shortPayload, LIMIT);
  assert.equal(shortFrames.length, 1, `${label}: short payload should produce single frame`);
  assert.equal(shortFrames[0].kind, 'atomic', `${label}: short payload should be atomic`);
  assert.equal(shortFrames[0].text, `${recipient} A:${shortPayload}`, `${label}: atomic text mismatch`);

  const longPayload = 'Z'.repeat(8000);
  const longFrames = suite.buildFrames(recipient, longPayload, LIMIT);
  assert.ok(longFrames.length > 1, `${label}: long payload should be chunked`);
  for (const frame of longFrames) {
    assert.equal(frame.kind, 'chunk', `${label}: all long frames must be chunk`);
    assert.ok(frame.text.length <= LIMIT, `${label}: frame exceeds limit`);
  }

  const assembler = suite.createAssembler();
  const byOrder = [...longFrames].reverse();
  let assembled: string | null = null;
  for (const frame of byOrder) {
    const parsedText = parseText(frame.text);
    const parsedData = suite.parseData(parsedText.data);
    assert.ok(parsedData && parsedData.kind === 'chunk', `${label}: chunk parse failed`);
    assembled = assembler.push(parsedText.recipientId, parsedData as any) || assembled;
  }
  assert.equal(assembled, longPayload, `${label}: out-of-order assemble mismatch`);

  const duplicateAssembler = suite.createAssembler();
  const firstText = parseText(longFrames[0].text);
  const firstChunk = suite.parseData(firstText.data);
  assert.ok(firstChunk && firstChunk.kind === 'chunk', `${label}: first chunk parse failed`);
  duplicateAssembler.push(firstText.recipientId, firstChunk as any);
  duplicateAssembler.push(firstText.recipientId, firstChunk as any);

  let duplicateAssembled: string | null = null;
  for (let i = 1; i < longFrames.length; i += 1) {
    const parsedText = parseText(longFrames[i].text);
    const parsedData = suite.parseData(parsedText.data);
    assert.ok(parsedData && parsedData.kind === 'chunk', `${label}: duplicate path parse failed`);
    duplicateAssembled = duplicateAssembler.push(parsedText.recipientId, parsedData as any) || duplicateAssembled;
  }
  assert.equal(duplicateAssembled, longPayload, `${label}: duplicate chunk assemble mismatch`);

  const legacy = suite.parseData('legacyPayload');
  assert.ok(legacy && legacy.kind === 'atomic', `${label}: legacy payload should be atomic`);
  assert.equal(legacy?.payload, 'legacyPayload', `${label}: legacy payload mismatch`);
}

runSuite('backend', {
  buildFrames: buildBackendFrames,
  parseData: parseBackendData as any,
  createAssembler: () => new BackendAssembler() as any,
});

runSuite('frontend', {
  buildFrames: buildFrontendFrames,
  parseData: parseFrontendData as any,
  createAssembler: () => new FrontendAssembler() as any,
});

console.log('[check-max-reserve-chunk-codec] OK');
