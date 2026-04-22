import {ref} from 'vue';
import {ws} from '@/composables/classes/ws';
import {restoreSession} from '@/composables/ws-rpc';
import type {GraphNode, GraphRoomTarget} from '@/composables/types';

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

  const roomRaw = raw?.room && typeof raw.room === 'object'
    ? raw.room
    : null;
  const roomId = Number(roomRaw?.id || 0);
  const room: GraphRoomTarget | null = roomRaw && Number.isFinite(roomId) && roomId > 0
    ? {
      id: roomId,
      kind: roomRaw.kind === 'direct' || roomRaw.kind === 'game' ? roomRaw.kind : 'group',
      title: roomRaw.title ? String(roomRaw.title) : null,
      createdById: Number(roomRaw.createdById || 0) || null,
      appEnabled: !!roomRaw.appEnabled,
      appType: roomRaw.appType || null,
      pinnedMessageId: Number(roomRaw.pinnedMessageId || 0) || null,
    }
    : null;

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
    room,
  };
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

export default {
  async setup() {
    const route = useRoute();
    const router = useRouter();
    return {
      route,
      router,
      loadingSpaces: ref(false),
      loadingChildren: ref(false),
      creatingSpace: ref(false),
      creatingFolder: ref(false),
      creatingRoomRef: ref(false),
      reorderPending: ref(false),
      archivePendingId: ref<number | null>(null),
      spaces: ref<GraphNode[]>([]),
      rooms: ref<GraphRoomTarget[]>([]),
      children: ref<GraphNode[]>([]),
      activeSpaceId: ref<number | null>(null),
      activePath: ref<GraphNode[]>([]),
      newSpaceTitle: ref(''),
      newFolderTitle: ref(''),
      newRoomId: ref(0),
      error: ref(''),
    };
  },

  computed: {
    activeContainer(this: any) {
      const path = Array.isArray(this.activePath) ? this.activePath : [];
      if (!path.length) return null;
      return path[path.length - 1];
    },
  },

  methods: {
    async ensureAuth(this: any) {
      const session = await restoreSession();
      if (!(session as any)?.ok) {
        await this.router.push('/login');
        return false;
      }
      return true;
    },

    fallbackRoomTitle(this: any, room: GraphRoomTarget) {
      if (room.kind === 'direct') return 'Direct';
      if (room.kind === 'game') return 'Game room';
      return 'Group room';
    },

    setError(this: any, errorRaw: unknown, fallback = 'Операция не выполнена') {
      const code = String(errorRaw || '').trim();
      this.error = code ? `${fallback}: ${code}` : fallback;
    },

    async fetchSpaces(this: any) {
      this.loadingSpaces = true;
      this.error = '';
      try {
        const result = await ws.request('graph:spaces:list');
        if (!Array.isArray(result)) {
          this.setError((result as any)?.error, 'Не удалось загрузить spaces');
          this.spaces = [];
          return;
        }
        this.spaces = result
          .map((nodeRaw: any) => normalizeGraphNode(nodeRaw))
          .filter(Boolean) as GraphNode[];
      } finally {
        this.loadingSpaces = false;
      }
    },

    async fetchRooms(this: any) {
      const result = await ws.request('graph:rooms:list');
      if (!Array.isArray(result)) {
        this.setError((result as any)?.error, 'Не удалось загрузить rooms');
        this.rooms = [];
        return;
      }
      this.rooms = result
        .map((roomRaw: any) => normalizeRoom(roomRaw))
        .filter(Boolean) as GraphRoomTarget[];
    },

    async loadChildren(this: any, parentNodeId: number) {
      this.loadingChildren = true;
      this.error = '';
      try {
        const result = await ws.request('graph:children', parentNodeId);
        if (!Array.isArray(result)) {
          this.setError((result as any)?.error, 'Не удалось загрузить children');
          this.children = [];
          return;
        }
        this.children = result
          .map((nodeRaw: any) => normalizeGraphNode(nodeRaw))
          .filter(Boolean) as GraphNode[];
      } finally {
        this.loadingChildren = false;
      }
    },

    async selectSpace(this: any, spaceIdRaw: unknown) {
      const spaceId = Number(spaceIdRaw || 0);
      if (!Number.isFinite(spaceId) || spaceId <= 0) return;
      const space = this.spaces.find((item: GraphNode) => item.id === spaceId);
      if (!space) return;

      this.activeSpaceId = space.id;
      this.activePath = [space];
      await this.loadChildren(space.id);
    },

    async selectPathIndex(this: any, indexRaw: unknown) {
      const index = Number(indexRaw || -1);
      if (!Number.isFinite(index) || index < 0) return;
      if (index >= this.activePath.length) return;
      this.activePath = this.activePath.slice(0, index + 1);
      const current = this.activePath[this.activePath.length - 1];
      if (!current) return;
      await this.loadChildren(current.id);
    },

    async openFolder(this: any, node: GraphNode) {
      if (!node || node.kind !== 'folder') return;
      this.activePath = [...this.activePath, node];
      await this.loadChildren(node.id);
    },

    async refreshChildren(this: any) {
      const current = this.activeContainer;
      if (!current) return;
      await this.loadChildren(current.id);
    },

    async refreshAll(this: any) {
      await this.fetchSpaces();
      await this.fetchRooms();
      const current = this.activeContainer;
      if (current) {
        const existsInList = this.spaces.some((space: GraphNode) => space.id === this.activeSpaceId);
        if (!existsInList) {
          this.activeSpaceId = null;
          this.activePath = [];
          this.children = [];
          return;
        }
        await this.refreshChildren();
      }
    },

    async onCreateSpace(this: any) {
      if (this.creatingSpace) return;
      this.creatingSpace = true;
      this.error = '';
      try {
        const result = await ws.request('graph:space:create', {
          title: this.newSpaceTitle,
        });
        if (!(result as any)?.ok) {
          this.setError((result as any)?.error, 'Не удалось создать space');
          return;
        }
        this.newSpaceTitle = '';
        await this.fetchSpaces();
        const createdNode = normalizeGraphNode((result as any)?.node);
        if (createdNode) {
          await this.selectSpace(createdNode.id);
        }
      } finally {
        this.creatingSpace = false;
      }
    },

    async onCreateFolder(this: any) {
      if (this.creatingFolder) return;
      const current = this.activeContainer;
      if (!current) return;
      this.creatingFolder = true;
      this.error = '';
      try {
        const result = await ws.request('graph:folder:create', {
          parentNodeId: current.id,
          title: this.newFolderTitle,
        });
        if (!(result as any)?.ok) {
          this.setError((result as any)?.error, 'Не удалось создать folder');
          return;
        }
        this.newFolderTitle = '';
        await this.refreshChildren();
      } finally {
        this.creatingFolder = false;
      }
    },

    async onCreateRoomRef(this: any) {
      if (this.creatingRoomRef) return;
      const current = this.activeContainer;
      const roomId = Number(this.newRoomId || 0);
      if (!current || !Number.isFinite(roomId) || roomId <= 0) return;

      this.creatingRoomRef = true;
      this.error = '';
      try {
        const result = await ws.request('graph:room-ref:create', {
          parentNodeId: current.id,
          roomId,
        });
        if (!(result as any)?.ok) {
          this.setError((result as any)?.error, 'Не удалось создать room_ref');
          return;
        }
        this.newRoomId = 0;
        await this.refreshChildren();
      } finally {
        this.creatingRoomRef = false;
      }
    },

    async moveNode(this: any, indexRaw: unknown, deltaRaw: unknown) {
      const index = Number(indexRaw || 0);
      const delta = Number(deltaRaw || 0);
      const current = this.activeContainer;
      if (!current) return;
      if (!Number.isFinite(index) || !Number.isFinite(delta) || delta === 0) return;
      const nextIndex = index + delta;
      if (index < 0 || index >= this.children.length) return;
      if (nextIndex < 0 || nextIndex >= this.children.length) return;
      if (this.reorderPending) return;

      const reordered = [...this.children];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(nextIndex, 0, moved);
      const childNodeIds = reordered.map((node: GraphNode) => node.id);

      this.reorderPending = true;
      this.error = '';
      try {
        const result = await ws.request('graph:children:reorder', {
          parentNodeId: current.id,
          childNodeIds,
        });
        if (!(result as any)?.ok) {
          this.setError((result as any)?.error, 'Не удалось поменять порядок');
          await this.refreshChildren();
          return;
        }
        const resultChildren = Array.isArray((result as any)?.children)
          ? (result as any).children
          : [];
        this.children = resultChildren
          .map((nodeRaw: any) => normalizeGraphNode(nodeRaw))
          .filter(Boolean) as GraphNode[];
      } finally {
        this.reorderPending = false;
      }
    },

    async archiveNode(this: any, node: GraphNode) {
      if (!node) return;
      if (this.archivePendingId) return;
      const confirmText = node.kind === 'folder'
        ? `Архивировать папку "${node.title}" вместе с дочерними узлами?`
        : `Архивировать "${node.title}"?`;
      if (!window.confirm(confirmText)) return;

      this.archivePendingId = node.id;
      this.error = '';
      try {
        const result = await ws.request('graph:node:archive', node.id);
        if (!(result as any)?.ok) {
          this.setError((result as any)?.error, 'Не удалось архивировать node');
          return;
        }

        if (node.id === this.activeSpaceId) {
          this.activeSpaceId = null;
          this.activePath = [];
          this.children = [];
          await this.fetchSpaces();
          return;
        }

        const pathIndex = this.activePath.findIndex((item: GraphNode) => item.id === node.id);
        if (pathIndex >= 0) {
          this.activePath = this.activePath.slice(0, Math.max(1, pathIndex));
        }
        await this.fetchSpaces();
        await this.refreshChildren();
      } finally {
        this.archivePendingId = null;
      }
    },

    async openRoomRef(this: any, node: GraphNode) {
      if (!node || node.kind !== 'room_ref') return;
      const roomId = Number(node.targetId || node.room?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      const spaceId = Number(this.activePath?.[0]?.id || this.activeSpaceId || 0);
      const query: Record<string, string> = {
        room: String(roomId),
        node: String(node.id),
      };
      if (Number.isFinite(spaceId) && spaceId > 0) {
        query.space = String(spaceId);
      }
      await this.router.push({
        path: '/chat',
        query,
      });
    },

    async initFromRoute(this: any) {
      const querySpaceId = Number(this.route?.query?.space || 0);
      if (Number.isFinite(querySpaceId) && querySpaceId > 0) {
        const exists = this.spaces.find((node: GraphNode) => node.id === querySpaceId);
        if (exists) {
          await this.selectSpace(querySpaceId);
          return;
        }
      }

      if (this.spaces.length > 0) {
        await this.selectSpace(this.spaces[0].id);
      }
    },
  },

  async mounted(this: any) {
    const ok = await this.ensureAuth();
    if (!ok) return;
    await this.fetchSpaces();
    await this.fetchRooms();
    await this.initFromRoute();
  },
};
