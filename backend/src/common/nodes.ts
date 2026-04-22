import {Prisma, PrismaClient} from '@prisma/client';
import {db} from '../db.js';

export type NodeType = 'room' | 'message';
export type RoomKind = 'group' | 'direct' | 'game' | 'comment';
export type RoomAppType = 'llm' | 'poll' | 'dashboard' | 'bot_control' | 'custom';
export type ScriptExecutionMode = 'client' | 'client_server' | 'client_runner';

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

export function normalizeRoomAppType(raw: unknown): RoomAppType | null {
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

export function readNodeScriptMode(nodeRaw: {clientScript?: unknown; serverScript?: unknown; data?: unknown}): ScriptExecutionMode | null {
  const node = {
    clientScript: nodeRaw.clientScript || null,
    serverScript: nodeRaw.serverScript || null,
    data: asRecord(nodeRaw.data),
  };
  const explicit = String(node.data?.scriptMode || '').trim().toLowerCase();
  if (explicit === 'client' || explicit === 'client_server' || explicit === 'client_runner') {
    return explicit;
  }
  if (node.clientScript && node.serverScript) return 'client_server';
  if (node.serverScript && !node.clientScript) return 'client_runner';
  if (node.clientScript) return 'client';
  return null;
}

export function readNodeScriptId(nodeRaw: {clientScript?: unknown; serverScript?: unknown}) {
  return String(nodeRaw.clientScript || nodeRaw.serverScript || '').trim().toLowerCase() || null;
}

export function readNodeScriptRevision(nodeRaw: {data?: unknown; clientScript?: unknown; serverScript?: unknown}) {
  const data = asRecord(nodeRaw.data);
  const revision = Number.parseInt(String(data.scriptRevision ?? ''), 10);
  if (Number.isFinite(revision) && revision > 0) return revision;
  return readNodeScriptId(nodeRaw) ? 1 : 0;
}

export function readNodeScriptConfig(nodeRaw: {data?: unknown}) {
  return asRecord(asRecord(nodeRaw.data).scriptConfig);
}

export function readNodeScriptState(nodeRaw: {data?: unknown}) {
  return asRecord(asRecord(nodeRaw.data).scriptState);
}

export function readRoomApp(nodeRaw: {data?: unknown}) {
  const roomApp = asRecord(asRecord(nodeRaw.data).roomApp);
  return {
    enabled: !!roomApp.enabled,
    type: normalizeRoomAppType(roomApp.type),
    config: asRecord(roomApp.config),
  };
}

export function mergeNodeData(input: {
  current?: unknown;
  scriptMode?: ScriptExecutionMode | null;
  scriptRevision?: number;
  scriptConfig?: unknown;
  scriptState?: unknown;
  roomApp?: {
    enabled: boolean;
    type: RoomAppType | null;
    config: Record<string, any>;
  } | null;
}) {
  const next = asRecord(input.current);

  if (input.scriptMode !== undefined) {
    if (input.scriptMode) next.scriptMode = input.scriptMode;
    else delete next.scriptMode;
  }

  if (input.scriptRevision !== undefined) {
    const revision = Number(input.scriptRevision || 0);
    if (Number.isFinite(revision) && revision > 0) next.scriptRevision = Math.round(revision);
    else delete next.scriptRevision;
  }

  if (input.scriptConfig !== undefined) {
    next.scriptConfig = asRecord(input.scriptConfig);
  }

  if (input.scriptState !== undefined) {
    next.scriptState = asRecord(input.scriptState);
  }

  if (input.roomApp !== undefined) {
    if (input.roomApp) {
      next.roomApp = {
        enabled: !!input.roomApp.enabled,
        type: normalizeRoomAppType(input.roomApp.type),
        config: asRecord(input.roomApp.config),
      };
    } else {
      delete next.roomApp;
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
