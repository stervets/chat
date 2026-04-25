<template>
          <div
            v-if="shouldShowPinnedPanel"
            class="pinned-panel"
            :class="{
              'pinned-panel-collapsed': pinnedCollapsed,
            }"
            :style="pinnedPanelStyle"
          >
            <div class="pinned-head">
              <span class="pinned-author" :style="getAuthorStyle(activePinnedMessage)">
                {{ activePinnedMessage.authorName }}
              </span>
              <div class="pinned-actions">
                <button
                  class="pinned-collapse-btn"
                  :title="pinnedCollapsed ? 'Развернуть закреп' : 'Свернуть закреп'"
                  @click="togglePinnedCollapsed"
                >
                  {{ pinnedCollapsed ? '▸' : '▾' }}
                </button>
                <button
                  v-if="canManagePinnedMessages"
                  class="pinned-unpin-btn"
                  title="Удалить закреп"
                  @click="unpinActiveMessage"
                >
                  откреп.
                </button>
              </div>
            </div>
            <div
              v-if="!pinnedCollapsed"
              class="pinned-body"
              @click="onPinnedBodyClick"
              v-html="getRenderedMessageHtml(activePinnedMessage, -1)"
            />
          </div>
          <div
            v-if="shouldShowPinnedPanel && !pinnedCollapsed"
            class="pinned-splitter"
            @pointerdown.prevent="onPinnedSplitterPointerDown"
          />
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
