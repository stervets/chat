import {Prisma} from '@prisma/client';
import {db} from '../../db.js';
import {getRoomById, userCanAccessRoom, type RoomAppType} from '../../common/rooms.js';
import {
  ChatContext,
  type ApiError,
  type ApiOk,
} from './chat-context.js';
import type {SocketState} from '../protocol.js';

type GraphNodeKind = 'space' | 'folder' | 'room_ref';
type GraphTargetType = 'none' | 'room';

type GraphNodePayload = {
  id: number;
  kind: GraphNodeKind;
  title: string;
  pathSegment: string | null;
  targetType: GraphTargetType;
  targetId: number | null;
  config: Record<string, any>;
  parentNodeId: number | null;
  sortOrder: number;
  room: {
    id: number;
    kind: 'group' | 'direct' | 'game';
    title: string | null;
    createdById: number | null;
    appEnabled: boolean;
    appType: RoomAppType | null;
    pinnedMessageId: number | null;
  } | null;
};

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeConfig(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return cloneJson(raw as Record<string, any>);
}

function normalizePathSegment(raw: unknown) {
  const value = String(raw || '').trim();
  if (!value) return null;
  return value.slice(0, 80);
}

function normalizeTitle(raw: unknown, fallback: string) {
  const value = String(raw || '').trim();
  return (value || fallback).slice(0, 160);
}

function normalizeNodeKind(raw: unknown): GraphNodeKind | null {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'space' || value === 'folder' || value === 'room_ref') return value;
  return null;
}

function normalizeRoomAppType(raw: unknown): RoomAppType | null {
  const appType = String(raw || '').trim().toLowerCase();
  if (appType === 'llm' || appType === 'poll' || appType === 'dashboard' || appType === 'bot_control' || appType === 'custom') {
    return appType;
  }
  return null;
}

export class ChatGraphService {
  constructor(private readonly ctx: ChatContext) {}

  private parseNodeId(raw: unknown) {
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  private parseRoomId(raw: unknown) {
    return this.ctx.parseRoomId(raw);
  }

  private toGraphNodePayload(input: {
    node: {
      id: number;
      kind: GraphNodeKind;
      title: string;
      pathSegment: string | null;
      targetType: GraphTargetType;
      targetId: number | null;
      configJson: any;
    };
    parentNodeId?: number | null;
    sortOrder?: number;
    room?: GraphNodePayload['room'];
  }): GraphNodePayload {
    return {
      id: Number(input.node.id || 0),
      kind: normalizeNodeKind(input.node.kind) || 'folder',
      title: String(input.node.title || ''),
      pathSegment: input.node.pathSegment || null,
      targetType: input.node.targetType === 'room' ? 'room' : 'none',
      targetId: Number(input.node.targetId || 0) > 0 ? Number(input.node.targetId || 0) : null,
      config: normalizeConfig(input.node.configJson),
      parentNodeId: Number(input.parentNodeId || 0) > 0 ? Number(input.parentNodeId || 0) : null,
      sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
      room: input.room || null,
    };
  }

  private toRoomRefPayload(room: Awaited<ReturnType<typeof getRoomById>>) {
    if (!room) return null;
    return {
      id: room.id,
      kind: room.kind,
      title: room.title || null,
      createdById: room.created_by || null,
      appEnabled: !!room.app_enabled,
      appType: normalizeRoomAppType(room.app_type),
      pinnedMessageId: Number(room.pinned_message_id || 0) || null,
    };
  }

  private async ensureParentContainer(parentNodeIdRaw: unknown): Promise<ApiError | {ok: true; parentNodeId: number}> {
    const parentNodeId = this.parseNodeId(parentNodeIdRaw);
    if (!parentNodeId) {
      return {ok: false, error: 'invalid_parent_node'};
    }

    const parent = await db.graphNode.findFirst({
      where: {
        id: parentNodeId,
        archivedAt: null,
      },
      select: {
        id: true,
        kind: true,
      },
    });

    if (!parent) {
      return {ok: false, error: 'parent_node_not_found'};
    }

    if (parent.kind !== 'space' && parent.kind !== 'folder') {
      return {ok: false, error: 'invalid_parent_node_kind'};
    }

    return {
      ok: true,
      parentNodeId,
    };
  }

  private async nextSortOrder(parentNodeId: number, tx: any = db) {
    const row = await tx.graphEdge.aggregate({
      where: {parentNodeId},
      _max: {sortOrder: true},
    });
    const maxSort = Number(row._max.sortOrder || -1);
    return maxSort + 1;
  }

  private async loadChildrenForUser(parentNodeId: number, userId: number): Promise<GraphNodePayload[]> {
    const edges = await db.graphEdge.findMany({
      where: {
        parentNodeId,
        childNode: {
          archivedAt: null,
        },
      },
      orderBy: [
        {sortOrder: 'asc'},
        {id: 'asc'},
      ],
      select: {
        parentNodeId: true,
        sortOrder: true,
        childNode: {
          select: {
            id: true,
            kind: true,
            title: true,
            pathSegment: true,
            targetType: true,
            targetId: true,
            configJson: true,
          },
        },
      },
    });

    const roomCache = new Map<number, Awaited<ReturnType<typeof getRoomById>>>();
    const result: GraphNodePayload[] = [];
    const archivedBrokenIds = new Set<number>();

    for (const edge of edges) {
      const node = edge.childNode;
      if (!node) continue;

      let roomPayload: GraphNodePayload['room'] = null;
      if (node.kind === 'room_ref') {
        const targetRoomId = Number(node.targetId || 0);
        if (node.targetType !== 'room' || !Number.isFinite(targetRoomId) || targetRoomId <= 0) {
          archivedBrokenIds.add(node.id);
          continue;
        }

        if (!roomCache.has(targetRoomId)) {
          roomCache.set(targetRoomId, await getRoomById(targetRoomId));
        }

        const room = roomCache.get(targetRoomId) || null;
        if (!room) {
          archivedBrokenIds.add(node.id);
          continue;
        }

        if (!userCanAccessRoom(userId, room)) {
          continue;
        }

        roomPayload = this.toRoomRefPayload(room);
      }

      result.push(this.toGraphNodePayload({
        node: {
          id: node.id,
          kind: normalizeNodeKind(node.kind) || 'folder',
          title: node.title,
          pathSegment: node.pathSegment || null,
          targetType: node.targetType === 'room' ? 'room' : 'none',
          targetId: Number(node.targetId || 0) > 0 ? Number(node.targetId || 0) : null,
          configJson: node.configJson,
        },
        parentNodeId: edge.parentNodeId,
        sortOrder: Number(edge.sortOrder || 0),
        room: roomPayload,
      }));
    }

    if (archivedBrokenIds.size > 0) {
      await db.graphNode.updateMany({
        where: {
          id: {in: Array.from(archivedBrokenIds)},
          archivedAt: null,
        },
        data: {
          archivedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    return result;
  }

  async graphSpacesList(state: SocketState): Promise<ApiError | GraphNodePayload[]> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const nodes = await db.graphNode.findMany({
      where: {
        kind: 'space',
        archivedAt: null,
      },
      orderBy: [
        {id: 'asc'},
      ],
      select: {
        id: true,
        kind: true,
        title: true,
        pathSegment: true,
        targetType: true,
        targetId: true,
        configJson: true,
      },
    });

    return nodes.map((node) => this.toGraphNodePayload({
      node: {
        id: node.id,
        kind: normalizeNodeKind(node.kind) || 'space',
        title: node.title,
        pathSegment: node.pathSegment || null,
        targetType: node.targetType === 'room' ? 'room' : 'none',
        targetId: Number(node.targetId || 0) > 0 ? Number(node.targetId || 0) : null,
        configJson: node.configJson,
      },
      parentNodeId: null,
      sortOrder: 0,
      room: null,
    }));
  }

  async graphChildren(
    state: SocketState,
    parentNodeIdRaw: unknown,
  ): Promise<ApiError | GraphNodePayload[]> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const parent = await this.ensureParentContainer(parentNodeIdRaw);
    if (parent.ok === false) return parent;

    return this.loadChildrenForUser(parent.parentNodeId, state.user!.id);
  }

  async graphSpaceCreate(
    state: SocketState,
    payloadRaw: any,
  ): Promise<ApiError | ApiOk<{node: GraphNodePayload}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
    const title = normalizeTitle(payload.title, 'Space');

    const node = await db.graphNode.create({
      data: {
        kind: 'space',
        title,
        pathSegment: normalizePathSegment(payload.pathSegment),
        targetType: 'none',
        targetId: null,
        configJson: normalizeConfig(payload.config),
      },
      select: {
        id: true,
        kind: true,
        title: true,
        pathSegment: true,
        targetType: true,
        targetId: true,
        configJson: true,
      },
    });

    return {
      ok: true,
      node: this.toGraphNodePayload({
        node: {
          id: node.id,
          kind: normalizeNodeKind(node.kind) || 'space',
          title: node.title,
          pathSegment: node.pathSegment || null,
          targetType: node.targetType === 'room' ? 'room' : 'none',
          targetId: Number(node.targetId || 0) > 0 ? Number(node.targetId || 0) : null,
          configJson: node.configJson,
        },
        parentNodeId: null,
        sortOrder: 0,
        room: null,
      }),
    };
  }

  async graphFolderCreate(
    state: SocketState,
    payloadRaw: any,
  ): Promise<ApiError | ApiOk<{node: GraphNodePayload}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
    const parent = await this.ensureParentContainer(payload.parentNodeId);
    if (parent.ok === false) return parent;

    const title = normalizeTitle(payload.title, 'Folder');

    const node = await db.$transaction(async (tx) => {
      const created = await tx.graphNode.create({
        data: {
          kind: 'folder',
          title,
          pathSegment: normalizePathSegment(payload.pathSegment),
          targetType: 'none',
          targetId: null,
          configJson: normalizeConfig(payload.config),
        },
        select: {
          id: true,
          kind: true,
          title: true,
          pathSegment: true,
          targetType: true,
          targetId: true,
          configJson: true,
        },
      });

      const nextSortOrder = await this.nextSortOrder(parent.parentNodeId, tx);
      await tx.graphEdge.create({
        data: {
          parentNodeId: parent.parentNodeId,
          childNodeId: created.id,
          edgeType: 'child',
          sortOrder: nextSortOrder,
          metaJson: {},
        },
      });

      return {
        ...created,
        sortOrder: nextSortOrder,
      };
    });

    return {
      ok: true,
      node: this.toGraphNodePayload({
        node: {
          id: node.id,
          kind: normalizeNodeKind(node.kind) || 'folder',
          title: node.title,
          pathSegment: node.pathSegment || null,
          targetType: node.targetType === 'room' ? 'room' : 'none',
          targetId: Number(node.targetId || 0) > 0 ? Number(node.targetId || 0) : null,
          configJson: node.configJson,
        },
        parentNodeId: parent.parentNodeId,
        sortOrder: Number(node.sortOrder || 0),
        room: null,
      }),
    };
  }

  async graphRoomRefCreate(
    state: SocketState,
    payloadRaw: any,
  ): Promise<ApiError | ApiOk<{node: GraphNodePayload}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
    const parent = await this.ensureParentContainer(payload.parentNodeId);
    if (parent.ok === false) return parent;

    const roomId = this.parseRoomId(payload.roomId);
    if (!roomId) return {ok: false, error: 'invalid_room'};

    const room = await getRoomById(roomId);
    if (!room) return {ok: false, error: 'room_not_found'};
    if (!userCanAccessRoom(state.user!.id, room)) return {ok: false, error: 'forbidden'};

    const title = normalizeTitle(payload.title, room.title || `Room #${roomId}`);

    const node = await db.$transaction(async (tx) => {
      const created = await tx.graphNode.create({
        data: {
          kind: 'room_ref',
          title,
          pathSegment: normalizePathSegment(payload.pathSegment),
          targetType: 'room',
          targetId: roomId,
          configJson: normalizeConfig(payload.config),
        },
        select: {
          id: true,
          kind: true,
          title: true,
          pathSegment: true,
          targetType: true,
          targetId: true,
          configJson: true,
        },
      });

      const nextSortOrder = await this.nextSortOrder(parent.parentNodeId, tx);
      await tx.graphEdge.create({
        data: {
          parentNodeId: parent.parentNodeId,
          childNodeId: created.id,
          edgeType: 'child',
          sortOrder: nextSortOrder,
          metaJson: {},
        },
      });

      return {
        ...created,
        sortOrder: nextSortOrder,
      };
    });

    return {
      ok: true,
      node: this.toGraphNodePayload({
        node: {
          id: node.id,
          kind: normalizeNodeKind(node.kind) || 'room_ref',
          title: node.title,
          pathSegment: node.pathSegment || null,
          targetType: node.targetType === 'room' ? 'room' : 'none',
          targetId: Number(node.targetId || 0) > 0 ? Number(node.targetId || 0) : null,
          configJson: node.configJson,
        },
        parentNodeId: parent.parentNodeId,
        sortOrder: Number(node.sortOrder || 0),
        room: this.toRoomRefPayload(room),
      }),
    };
  }

  async graphChildrenReorder(
    state: SocketState,
    payloadRaw: any,
  ): Promise<ApiError | ApiOk<{children: GraphNodePayload[]}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
    const parent = await this.ensureParentContainer(payload.parentNodeId);
    if (parent.ok === false) return parent;

    const childNodeIdsRaw = Array.isArray(payload.childNodeIds) ? payload.childNodeIds : [];
    const childNodeIds = Array.from(new Set(
      childNodeIdsRaw
        .map((item) => this.parseNodeId(item))
        .filter((item) => !!item) as number[],
    ));
    if (!childNodeIds.length) {
      return {ok: false, error: 'invalid_child_nodes'};
    }

    const currentEdges = await db.graphEdge.findMany({
      where: {
        parentNodeId: parent.parentNodeId,
        childNode: {
          archivedAt: null,
        },
      },
      orderBy: [
        {sortOrder: 'asc'},
        {id: 'asc'},
      ],
      select: {
        childNodeId: true,
      },
    });

    if (!currentEdges.length) {
      return {ok: false, error: 'no_children'};
    }

    const knownIds = new Set(currentEdges.map((edge) => Number(edge.childNodeId || 0)));
    const reordered = childNodeIds.filter((id) => knownIds.has(id));
    const seen = new Set(reordered);
    const tail = currentEdges
      .map((edge) => Number(edge.childNodeId || 0))
      .filter((id) => !seen.has(id));
    const nextOrder = [...reordered, ...tail];

    if (!nextOrder.length) {
      return {ok: false, error: 'invalid_child_nodes'};
    }

    await db.$transaction(
      nextOrder.map((childNodeId, index) => db.graphEdge.updateMany({
        where: {
          parentNodeId: parent.parentNodeId,
          childNodeId,
        },
        data: {
          sortOrder: index,
        },
      })),
    );

    return {
      ok: true,
      children: await this.loadChildrenForUser(parent.parentNodeId, state.user!.id),
    };
  }

  async graphNodeArchive(
    state: SocketState,
    nodeIdRaw: unknown,
  ): Promise<ApiError | ApiOk<{nodeId: number; archived: boolean}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const nodeId = this.parseNodeId(nodeIdRaw);
    if (!nodeId) return {ok: false, error: 'invalid_node'};

    const node = await db.graphNode.findFirst({
      where: {
        id: nodeId,
      },
      select: {
        id: true,
        archivedAt: true,
      },
    });
    if (!node) return {ok: false, error: 'node_not_found'};
    if (node.archivedAt) {
      return {
        ok: true,
        nodeId,
        archived: false,
      };
    }

    await db.$executeRaw(
      Prisma.sql`
        with recursive subtree as (
          select n.id
          from graph_nodes n
          where n.id = ${nodeId}

          union all

          select e.child_node_id
          from graph_edges e
          join subtree s on s.id = e.parent_node_id
        )
        update graph_nodes n
        set archived_at = now(),
            updated_at = now()
        where n.id in (select id from subtree)
          and n.archived_at is null
      `,
    );

    return {
      ok: true,
      nodeId,
      archived: true,
    };
  }

  async graphRoomsList(state: SocketState): Promise<ApiError | Array<{
    id: number;
    kind: 'group' | 'direct' | 'game';
    title: string | null;
    createdById: number | null;
    appEnabled: boolean;
    appType: RoomAppType | null;
    pinnedMessageId: number | null;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const rows = await db.room.findMany({
      where: {
        roomUsers: {
          some: {
            userId: state.user!.id,
          },
        },
      },
      orderBy: [
        {kind: 'asc'},
        {id: 'asc'},
      ],
      select: {
        id: true,
        kind: true,
        title: true,
        createdById: true,
        appEnabled: true,
        appType: true,
        pinnedMessageId: true,
      },
    });

    return rows.map((row) => ({
      id: Number(row.id || 0),
      kind: row.kind === 'direct' || row.kind === 'game' ? row.kind : 'group',
      title: row.title || null,
      createdById: Number(row.createdById || 0) || null,
      appEnabled: !!row.appEnabled,
      appType: normalizeRoomAppType(row.appType),
      pinnedMessageId: Number(row.pinnedMessageId || 0) || null,
    }));
  }
}
