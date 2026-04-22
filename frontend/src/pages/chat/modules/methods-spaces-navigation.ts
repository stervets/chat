import {ws} from './shared';
import type {
  GraphNode,
  GraphNodeKind,
  GraphRoomTarget,
} from './shared';

function parsePositiveInt(raw: unknown) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeRoom(raw: any): GraphRoomTarget | null {
  const id = Number(raw?.id || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    kind: raw?.kind === 'direct' || raw?.kind === 'game' ? raw.kind : 'group',
    title: raw?.title ? String(raw.title) : null,
    createdById: Number(raw?.createdById || 0) || null,
    appEnabled: !!raw?.appEnabled,
    appType: raw?.appType || null,
    pinnedMessageId: Number(raw?.pinnedMessageId || 0) || null,
  };
}

function normalizeGraphNode(raw: any): GraphNode | null {
  const id = Number(raw?.id || 0);
  if (!Number.isFinite(id) || id <= 0) return null;

  const kindRaw = String(raw?.kind || '').trim().toLowerCase();
  const kind = kindRaw === 'space' || kindRaw === 'folder' || kindRaw === 'room_ref'
    ? kindRaw
    : null;
  if (!kind) return null;

  const targetTypeRaw = String(raw?.targetType || '').trim().toLowerCase();
  const targetType = targetTypeRaw === 'room' ? 'room' : 'none';
  const targetId = Number(raw?.targetId || 0);
  const parentNodeId = Number(raw?.parentNodeId || 0);

  return {
    id,
    kind,
    title: String(raw?.title || `Node #${id}`),
    pathSegment: raw?.pathSegment ? String(raw.pathSegment) : null,
    targetType,
    targetId: Number.isFinite(targetId) && targetId > 0 ? targetId : null,
    config: raw?.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
      ? {...raw.config}
      : {},
    parentNodeId: Number.isFinite(parentNodeId) && parentNodeId > 0 ? parentNodeId : null,
    sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : 0,
    room: normalizeRoom(raw?.room),
  };
}

export const chatMethodsSpacesNavigation = {
  getSpaceOriginIdFromRoute(this: any) {
    const raw = Array.isArray(this.route?.query?.space)
      ? this.route.query.space[0]
      : this.route?.query?.space;
    return parsePositiveInt(raw);
  },

  getSpaceNodeOriginIdFromRoute(this: any) {
    const raw = Array.isArray(this.route?.query?.node)
      ? this.route.query.node[0]
      : this.route?.query?.node;
    return parsePositiveInt(raw);
  },

  spacesNodeKindLabel(this: any, kindRaw: unknown) {
    const kind = String(kindRaw || '').trim().toLowerCase();
    if (kind === 'space') return 'SPACE';
    if (kind === 'folder') return 'FOLDER';
    if (kind === 'room_ref') return 'ROOM';
    return 'NODE';
  },

  spacesNodeRoomMeta(this: any, node: GraphNode) {
    if (!node || node.kind !== 'room_ref') return '';
    const room = node.room;
    if (!room) return 'room';

    const kindLabel = room.kind === 'direct'
      ? 'direct'
      : (room.kind === 'game' ? 'game' : 'group');
    const appLabel = room.appEnabled ? ` · app:${room.appType || 'custom'}` : '';
    return `${kindLabel}${appLabel}`;
  },

  isSpacesNavNodeActive(this: any, node: GraphNode) {
    if (!node || node.kind !== 'room_ref') return false;
    const roomId = Number(node.targetId || node.room?.id || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) return false;
    return Number(this.activeDialog?.id || 0) === roomId;
  },

  async fetchSpacesNavigationSpaces(this: any, optionsRaw?: {silent?: boolean}) {
    const silent = !!optionsRaw?.silent;
    if (!silent) {
      this.spacesNavLoading = true;
      this.spacesNavError = '';
    }

    try {
      const result = await ws.request('graph:spaces:list');
      if (!Array.isArray(result)) {
        this.spacesNavError = `Spaces недоступны: ${String((result as any)?.error || 'unknown_error')}`;
        this.spacesNavSpaces = [];
        return false;
      }
      this.spacesNavSpaces = result
        .map((nodeRaw: any) => normalizeGraphNode(nodeRaw))
        .filter(Boolean) as GraphNode[];
      if (!silent) {
        this.spacesNavError = '';
      }
      return true;
    } finally {
      if (!silent) {
        this.spacesNavLoading = false;
      }
    }
  },

  async loadSpacesNavigationChildren(this: any, parentNodeIdRaw: unknown, optionsRaw?: {silent?: boolean}) {
    const parentNodeId = parsePositiveInt(parentNodeIdRaw);
    if (!parentNodeId) {
      this.spacesNavChildren = [];
      return false;
    }

    const silent = !!optionsRaw?.silent;
    if (!silent) {
      this.spacesNavLoading = true;
    }

    try {
      const result = await ws.request('graph:children', parentNodeId);
      if (!Array.isArray(result)) {
        this.spacesNavError = `Не удалось загрузить space: ${String((result as any)?.error || 'unknown_error')}`;
        this.spacesNavChildren = [];
        return false;
      }
      this.spacesNavChildren = result
        .map((nodeRaw: any) => normalizeGraphNode(nodeRaw))
        .filter(Boolean) as GraphNode[];
      return true;
    } finally {
      if (!silent) {
        this.spacesNavLoading = false;
      }
    }
  },

  async selectSpacesNavigationSpace(this: any, spaceIdRaw: unknown, optionsRaw?: {silent?: boolean}) {
    const spaceId = parsePositiveInt(spaceIdRaw);
    if (!spaceId) return false;
    const space = this.spacesNavSpaces.find((item: GraphNode) => item.id === spaceId && item.kind === 'space');
    if (!space) return false;

    this.spacesNavActiveSpaceId = spaceId;
    this.spacesNavPath = [space];
    return this.loadSpacesNavigationChildren(spaceId, optionsRaw);
  },

  async selectSpacesNavigationPath(this: any, indexRaw: unknown) {
    const index = Number(indexRaw || -1);
    if (!Number.isFinite(index) || index < 0) return;
    if (index >= this.spacesNavPath.length) return;
    this.spacesNavPath = this.spacesNavPath.slice(0, index + 1);
    const current = this.spacesNavPath[this.spacesNavPath.length - 1];
    if (!current) {
      this.spacesNavChildren = [];
      return;
    }
    await this.loadSpacesNavigationChildren(current.id);
  },

  async openSpacesNavigationFolder(this: any, node: GraphNode) {
    if (!node || node.kind !== 'folder') return;
    this.spacesNavPath = [...this.spacesNavPath, node];
    await this.loadSpacesNavigationChildren(node.id);
  },

  async openSpacesNavigationRoomRef(this: any, node: GraphNode) {
    if (!node || node.kind !== 'room_ref') return;
    const roomId = Number(node.targetId || node.room?.id || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) return;

    const spaceId = Number(this.spacesNavPath?.[0]?.id || this.spacesNavActiveSpaceId || 0);
    const query: Record<string, string> = {
      room: String(roomId),
    };
    if (Number.isFinite(spaceId) && spaceId > 0) {
      query.space = String(spaceId);
    }
    query.node = String(node.id);

    await this.router.push({
      path: '/chat',
      query,
    });
    this.closeLeftMenu();
  },

  async onSpacesNavigationNodeClick(this: any, node: GraphNode) {
    if (!node) return;
    this.hapticTap();
    if (node.kind === 'folder') {
      await this.openSpacesNavigationFolder(node);
      return;
    }
    if (node.kind === 'room_ref') {
      await this.openSpacesNavigationRoomRef(node);
    }
  },

  async refreshSpacesNavigation(this: any, optionsRaw?: {silent?: boolean}) {
    const silent = !!optionsRaw?.silent;
    const loaded = await this.fetchSpacesNavigationSpaces({silent});
    if (!loaded) return;

    if (!this.spacesNavSpaces.length) {
      this.spacesNavActiveSpaceId = null;
      this.spacesNavPath = [];
      this.spacesNavChildren = [];
      return;
    }

    const routeSpaceId = this.getSpaceOriginIdFromRoute();
    const preferredSpaceId = routeSpaceId || Number(this.spacesNavActiveSpaceId || 0) || Number(this.spacesNavPath?.[0]?.id || 0);
    const targetSpace = this.spacesNavSpaces.find((item: GraphNode) => item.id === preferredSpaceId && item.kind === 'space')
      || this.spacesNavSpaces[0];

    if (!targetSpace) return;

    const currentContainerId = Number(this.spacesNavPath?.[this.spacesNavPath.length - 1]?.id || 0);
    const shouldResetPath = !this.spacesNavPath.length || Number(this.spacesNavPath?.[0]?.id || 0) !== targetSpace.id;
    if (shouldResetPath) {
      this.spacesNavPath = [targetSpace];
    }

    this.spacesNavActiveSpaceId = targetSpace.id;
    const containerId = shouldResetPath
      ? targetSpace.id
      : (currentContainerId > 0 ? currentContainerId : targetSpace.id);
    await this.loadSpacesNavigationChildren(containerId, {silent});
  },

  async initSpacesNavigation(this: any) {
    await this.refreshSpacesNavigation();
  },

  async openSpacesPageFromChat(this: any) {
    this.hapticTap();
    const spaceId = Number(this.spacesNavPath?.[0]?.id || this.spacesNavActiveSpaceId || this.getSpaceOriginIdFromRoute() || 0);
    const query = Number.isFinite(spaceId) && spaceId > 0
      ? {space: String(spaceId)}
      : undefined;
    this.closeLeftMenu();
    await this.router.push({
      path: '/spaces',
      ...(query ? {query} : {}),
    });
  },

  async onBackToSpaceFromRoom(this: any) {
    const spaceId = this.getSpaceOriginIdFromRoute() || Number(this.spacesNavPath?.[0]?.id || this.spacesNavActiveSpaceId || 0);
    if (!spaceId) {
      await this.router.push('/spaces');
      return;
    }
    await this.router.push({
      path: '/spaces',
      query: {space: String(spaceId)},
    });
  },
};
