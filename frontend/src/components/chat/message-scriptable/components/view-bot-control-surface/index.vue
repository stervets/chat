<template>
  <div class="scriptable-card scriptable-card-bot-control">
    <div class="scriptable-title">{{ viewModel.title || 'Bot control' }}</div>
    <div class="scriptable-bot-status-row">
      <span class="scriptable-meta">Статус:</span>
      <span :class="viewModel.enabled ? 'scriptable-status-on' : 'scriptable-status-off'">
        {{ viewModel.enabled ? 'ON' : 'OFF' }}
      </span>
    </div>
    <div class="scriptable-bot-controls">
      <button
        class="scriptable-btn scriptable-btn-compact"
        :disabled="!!viewModel.pending"
        @click="toggleEnabled(true)"
      >
        ON
      </button>
      <button
        class="scriptable-btn scriptable-btn-compact"
        :disabled="!!viewModel.pending"
        @click="toggleEnabled(false)"
      >
        OFF
      </button>
    </div>
    <div class="scriptable-bot-level-row">
      <input
        :value="levelDraft"
        class="scriptable-bot-level-input"
        type="range"
        min="0"
        max="100"
        step="1"
        :disabled="!!viewModel.pending"
        @input="onLevelInput"
      />
      <button
        class="scriptable-btn scriptable-btn-compact"
        :disabled="!!viewModel.pending"
        @click="submitLevel"
      >
        {{ Number(levelDraft || viewModel.level || 0) }}%
      </button>
    </div>
    <div class="scriptable-meta">Room events: {{ Number(viewModel.chatEvents || 0) }}</div>
    <div v-if="viewModel.updatedAt" class="scriptable-meta">Updated: {{ viewModel.updatedAt }}</div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
