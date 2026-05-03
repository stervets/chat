<template>
  <div class="scriptable-card scriptable-card-poll">
    <div class="scriptable-title">{{ viewModel.title || 'Poll' }}</div>
    <div class="scriptable-poll-question">{{ viewModel.question || 'Выберите вариант' }}</div>
    <div class="scriptable-poll-options">
      <button
        v-for="option in (viewModel.options || [])"
        :key="`poll-option-${option.index}`"
        class="scriptable-btn scriptable-poll-option-btn"
        :disabled="!!viewModel.pending"
        @click="vote(option.index)"
      >
        <span class="scriptable-poll-option-label">{{ option.label }}</span>
        <span class="scriptable-poll-option-votes">{{ Number(option.votes || 0) }}</span>
      </button>
    </div>
    <div class="scriptable-meta">Голосов: {{ Number(viewModel.totalVotes || 0) }}</div>
    <div class="scriptable-meta">События комнаты: {{ Number(viewModel.chatEvents || 0) }}</div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
