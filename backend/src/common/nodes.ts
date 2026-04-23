import {Prisma, PrismaClient} from '@prisma/client';
import {db} from '../db.js';

export type NodeType = 'room' | 'message';
export type RoomKind = 'group' | 'direct' | 'game' | 'comment';
export type RoomSurfaceType = 'llm' | 'poll' | 'dashboard' | 'bot_control' | 'custom';
export type ScriptExecutionMode = 'client' | 'client_server' | 'client_runner';
export type NodeRuntimeSnapshot = {
  clientScript: string | null;
  serverScript: string | null;
  data: NodeDataRecord;
};

export type NodeDataRecord = Record<string, any>;
export type NodeSnapshot = {
  id: number;
  parentId: number | null;
  type: NodeType;
  component: string | null;
  clientScript: string | null;
  serverScript: string | null;
  data: NodeDataRecord;
  createdById: number | null;
  createdAt: Date;
};

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

export function normalizeRoomSurfaceType(raw: unknown): RoomSurfaceType | null {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'llm' || value === 'poll' || value === 'dashboard' || value === 'bot_control' || value === 'custom') {
    return value;
  }
  return null;
}

export function normalizeNodeSnapshot(raw: any): NodeSnapshot {
  return {
    id: Number(raw?.id || 0),
    parentId: Number(raw?.parentId || 0) || null,
    type: String(raw?.type || '').trim().toLowerCase() === 'message' ? 'message' : 'room',
    component: raw?.component ? String(raw.component) : null,
    clientScript: raw?.clientScript ? String(raw.clientScript) : null,
    serverScript: raw?.serverScript ? String(raw.serverScript) : null,
    data: asRecord(raw?.data),
    createdById: Number(raw?.createdById || 0) || null,
    createdAt: raw?.createdAt instanceof Date ? raw.createdAt : new Date(raw?.createdAt || Date.now()),
  };
}

export function readNodeRuntime(nodeRaw: {clientScript?: unknown; serverScript?: unknown; data?: unknown}): NodeRuntimeSnapshot {
  return {
    clientScript: nodeRaw?.clientScript ? String(nodeRaw.clientScript) : null,
    serverScript: nodeRaw?.serverScript ? String(nodeRaw.serverScript) : null,
    data: asRecord(nodeRaw?.data),
  };
}

export function readNodeScriptId(nodeRaw: {clientScript?: unknown; serverScript?: unknown}) {
  return String(nodeRaw.clientScript || nodeRaw.serverScript || '').trim().toLowerCase() || null;
}

export function hasNodeClientRuntime(nodeRaw: {clientScript?: unknown}) {
  return !!String(nodeRaw?.clientScript || '').trim();
}

export function hasNodeServerRuntime(nodeRaw: {serverScript?: unknown}) {
  return !!String(nodeRaw?.serverScript || '').trim();
}

export function resolveNodeRuntimeMode(nodeRaw: {clientScript?: unknown; serverScript?: unknown}): ScriptExecutionMode | null {
  const hasClient = hasNodeClientRuntime(nodeRaw);
  const hasServer = hasNodeServerRuntime(nodeRaw);
  if (hasClient && hasServer) return 'client_server';
  if (!hasClient && hasServer) return 'client_runner';
  if (hasClient) return 'client';
  return null;
}

export function readNodeScriptConfigData(nodeRaw: {data?: unknown}) {
  return asRecord(asRecord(nodeRaw.data).scriptConfig);
}

export function readNodeScriptStateData(nodeRaw: {data?: unknown}) {
  return asRecord(asRecord(nodeRaw.data).scriptState);
}

export function readRoomSurface(nodeRaw: {data?: unknown}) {
  const roomSurface = asRecord(asRecord(nodeRaw.data).roomSurface);
  return {
    enabled: !!roomSurface.enabled,
    type: normalizeRoomSurfaceType(roomSurface.type),
    config: asRecord(roomSurface.config),
  };
}

export function mergeNodeData(input: {
  current?: unknown;
  patch?: unknown;
  scriptConfig?: unknown;
  scriptState?: unknown;
  roomSurface?: {
    enabled: boolean;
    type: RoomSurfaceType | null;
    config: Record<string, any>;
  } | null;
}) {
  const next = asRecord(input.current);

  if (input.patch !== undefined) {
    Object.assign(next, asRecord(input.patch));
  }

  if (input.scriptConfig !== undefined) {
    next.scriptConfig = asRecord(input.scriptConfig);
  }

  if (input.scriptState !== undefined) {
    next.scriptState = asRecord(input.scriptState);
  }

  if (input.roomSurface !== undefined) {
    if (input.roomSurface) {
      next.roomSurface = {
        enabled: !!input.roomSurface.enabled,
        type: normalizeRoomSurfaceType(input.roomSurface.type),
        config: asRecord(input.roomSurface.config),
      };
    } else {
      delete next.roomSurface;
    }
  }

  return next;
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
