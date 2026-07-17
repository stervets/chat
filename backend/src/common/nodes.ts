import {Prisma, PrismaClient} from '@prisma/client';
import {db} from '../db.js';

export type NodeType = 'room' | 'message';
export type RoomKind = 'group' | 'direct' | 'game' | 'comment';
export type NodeRuntimeSnapshot = {
  clientScript: string | null;
  serverScript: string | null;
  data: NodeDataRecord;
};

export type NodeDataRecord = Record<string, any>;
type DbClient = Prisma.TransactionClient | PrismaClient | typeof db;

function asRecord(raw: unknown): NodeDataRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return cloneJson(raw as Record<string, any>);
}

export function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export function normalizeRoomKind(raw: unknown): RoomKind {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'direct' || value === 'game' || value === 'comment') return value;
  return 'group';
}

export function readNodeRuntime(nodeRaw: {clientScript?: unknown; serverScript?: unknown; data?: unknown}): NodeRuntimeSnapshot {
  return {
    clientScript: nodeRaw?.clientScript ? String(nodeRaw.clientScript) : null,
    serverScript: nodeRaw?.serverScript ? String(nodeRaw.serverScript) : null,
    data: asRecord(nodeRaw?.data),
  };
}

export async function createNode(client: DbClient, data: {
  parentId?: number | null;
  type: NodeType;
  component?: string | null;
  clientScript?: string | null;
  serverScript?: string | null;
  data?: unknown;
  createdById?: number | null;
  createdAt?: Date;
}) {
  return client.node.create({
    data: {
      parentId: data.parentId ?? null,
      type: data.type,
      component: data.component || null,
      clientScript: data.clientScript || null,
      serverScript: data.serverScript || null,
      data: asRecord(data.data),
      createdById: data.createdById ?? null,
      ...(data.createdAt ? {createdAt: data.createdAt} : {}),
    },
  });
}

export async function createRoomNode(client: DbClient, data: {
  parentId?: number | null;
  kind: RoomKind;
  title?: string | null;
  createdById?: number | null;
  component?: string | null;
  clientScript?: string | null;
  serverScript?: string | null;
  nodeData?: unknown;
  createdAt?: Date;
}) {
  const node = await createNode(client, {
    parentId: data.parentId ?? null,
    type: 'room',
    component: data.component || null,
    clientScript: data.clientScript || null,
    serverScript: data.serverScript || null,
    data: data.nodeData,
    createdById: data.createdById ?? null,
    createdAt: data.createdAt,
  });

  const room = await client.room.create({
    data: {
      id: node.id,
      kind: normalizeRoomKind(data.kind),
      title: data.title || null,
    },
  });

  return {node, room};
}

export async function createMessageNode(client: DbClient, data: {
  roomId: number;
  senderId?: number | null;
  kind: 'text' | 'system' | 'scriptable';
  rawText: string;
  renderedHtml: string;
  createdById?: number | null;
  component?: string | null;
  clientScript?: string | null;
  serverScript?: string | null;
  nodeData?: unknown;
  createdAt?: Date;
}) {
  const createdAt = data.createdAt || new Date();
  const node = await createNode(client, {
    parentId: data.roomId,
    type: 'message',
    component: data.component || null,
    clientScript: data.clientScript || null,
    serverScript: data.serverScript || null,
    data: data.nodeData,
    createdById: data.createdById ?? data.senderId ?? null,
    createdAt,
  });

  const message = await client.message.create({
    data: {
      id: node.id,
      senderId: data.senderId ?? null,
      kind: data.kind,
      rawText: data.rawText,
      renderedHtml: data.renderedHtml,
      createdAt,
    },
  });

  return {node, message};
}

export async function findCommentRoomNodeIdByMessageId(messageId: number) {
  const row = await db.room.findFirst({
    where: {
      kind: 'comment',
      node: {
        parentId: messageId,
      },
    },
    select: {
      id: true,
    },
  });
  return Number(row?.id || 0) || null;
}
