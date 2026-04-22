<template>
  <div class="page page-spaces">
    <div class="spaces-shell">
      <header class="spaces-header">
        <div class="spaces-title-wrap">
          <div class="spaces-title">Пространства</div>
          <div class="spaces-subtitle">Контейнеры комнат и app rooms</div>
        </div>
        <div class="spaces-header-actions">
          <NuxtLink class="nav-link" to="/chat">Чат</NuxtLink>
          <button class="btn ghost" :disabled="loadingChildren || loadingSpaces" @click="refreshAll">
            Обновить
          </button>
        </div>
      </header>

      <div class="spaces-toolbar">
        <input
          v-model="newSpaceTitle"
          class="input"
          type="text"
          maxlength="160"
          placeholder="Новый space (например, DeepSeek)"
          @keydown.enter.prevent="onCreateSpace"
        />
        <button class="btn" :disabled="creatingSpace" @click="onCreateSpace">
          Создать space
        </button>
      </div>

      <div v-if="error" class="error">{{ error }}</div>

      <div class="spaces-body">
        <aside class="spaces-list">
          <div class="section-title">Пространства</div>
          <div v-if="loadingSpaces" class="hint">Загрузка spaces...</div>
          <div v-else-if="!spaces.length" class="hint">Пока нет spaces</div>
          <div v-else class="list">
            <button
              v-for="space in spaces"
              :key="`space-${space.id}`"
              class="node-btn"
              :class="{active: activeSpaceId === space.id}"
              @click="selectSpace(space.id)"
            >
              <span class="node-kind">SPACE</span>
              <span class="node-title">{{ space.title }}</span>
            </button>
          </div>
        </aside>

        <main class="spaces-content">
          <div v-if="!activeContainer" class="hint">Выбери space слева</div>

          <template v-else>
            <div class="path-row">
              <button
                v-for="(node, index) in activePath"
                :key="`path-${node.id}`"
                class="path-btn"
                :class="{active: index === activePath.length - 1}"
                @click="selectPathIndex(index)"
              >
                {{ node.title }}
              </button>
            </div>

            <div class="container-toolbar">
              <div class="toolbar-item">
                <input
                  v-model="newFolderTitle"
                  class="input"
                  type="text"
                  maxlength="160"
                  placeholder="Новая папка"
                  @keydown.enter.prevent="onCreateFolder"
                />
                <button class="btn ghost" :disabled="creatingFolder" @click="onCreateFolder">
                  + folder
                </button>
              </div>

              <div class="toolbar-item room-ref-row">
                <select v-model.number="newRoomId" class="input select">
                  <option :value="0">Выбери room...</option>
                  <option
                    v-for="room in rooms"
                    :key="`room-${room.id}`"
                    :value="room.id"
                  >
                    #{{ room.id }} · {{ room.title || fallbackRoomTitle(room) }} · {{ room.kind }}{{ room.appEnabled ? ` · app:${room.appType || 'custom'}` : '' }}
                  </option>
                </select>
                <button class="btn ghost" :disabled="creatingRoomRef || !newRoomId" @click="onCreateRoomRef">
                  + room_ref
                </button>
              </div>
            </div>

            <div class="legend-row">
              <span class="legend-item">SPACE/FOLDER = контейнеры</span>
              <span class="legend-item">ROOM REF = переход в обычный чат</span>
            </div>

            <div v-if="loadingChildren" class="hint">Загрузка children...</div>
            <div v-else-if="!children.length" class="hint">Контейнер пустой</div>

            <div v-else class="children-list">
              <div
                v-for="(node, index) in children"
                :key="`child-${node.id}`"
                class="child-item"
              >
                <div class="child-main">
                  <button
                    v-if="node.kind === 'folder'"
                    class="child-open-btn"
                    @click="openFolder(node)"
                  >
                    <span class="child-kind">FOLDER</span>
                    <span class="child-title">{{ node.title }}</span>
                  </button>

                  <button
                    v-else-if="node.kind === 'room_ref'"
                    class="child-open-btn room-ref-btn"
                    @click="openRoomRef(node)"
                  >
                    <span class="child-kind">ROOM REF</span>
                    <span class="child-title">{{ node.title }}</span>
                    <span class="child-meta">
                      #{{ node.room?.id || node.targetId }} · {{ node.room?.kind || 'room' }}{{ node.room?.appEnabled ? ` · app:${node.room?.appType || 'custom'}` : '' }}
                    </span>
                    <span v-if="node.room?.appEnabled" class="child-app-badge">
                      APP · {{ node.room?.appType || 'custom' }}
                    </span>
                  </button>

                  <div v-else class="child-open-btn disabled">
                    <span class="child-kind">NODE</span>
                    <span class="child-title">{{ node.title }}</span>
                  </div>
                </div>

                <div class="child-actions">
                  <button
                    class="icon-btn"
                    :disabled="index === 0 || reorderPending"
                    title="Выше"
                    @click="moveNode(index, -1)"
                  >
                    ↑
                  </button>
                  <button
                    class="icon-btn"
                    :disabled="index >= children.length - 1 || reorderPending"
                    title="Ниже"
                    @click="moveNode(index, 1)"
                  >
                    ↓
                  </button>
                  <button
                    class="icon-btn danger"
                    :disabled="archivePendingId === node.id"
                    title="Архивировать"
                    @click="archiveNode(node)"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </template>
        </main>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
