<template>
  <div class="scriptable-card scriptable-card-guess">
    <div class="scriptable-title">{{ viewModel.title || 'Guess word' }}</div>
    <div class="scriptable-guess-mask">{{ viewModel.mask || '***' }}</div>
    <div v-if="viewModel.hint" class="scriptable-guess-hint">{{ viewModel.hint }}</div>

    <div class="scriptable-guess-controls">
      <input
        :value="guessInput"
        class="scriptable-guess-input"
        type="text"
        placeholder="введи слово"
        @input="onGuessInput"
        @keydown.enter.prevent="$emit('submit')"
      />
      <button
        class="scriptable-btn scriptable-btn-compact"
        :disabled="!!viewModel.pending"
        @click="$emit('submit')"
      >
        {{ viewModel.pending ? '...' : 'OK' }}
      </button>
    </div>

    <div class="scriptable-meta">Попыток: {{ Number(viewModel.attempts || 0) }}</div>
    <div v-if="Array.isArray(viewModel.winners) && viewModel.winners.length" class="scriptable-winners">
      Победили:
      <span
        v-for="winner in viewModel.winners"
        :key="`winner-${winner.userId}`"
        class="scriptable-winner-chip"
      >
        {{ winner.name || winner.nickname || `id:${winner.userId}` }}
      </span>
    </div>
    <div
      v-if="viewModel.lastGuess && viewModel.lastGuess.nickname"
      class="scriptable-last-guess"
    >
      Последняя попытка: @{{ viewModel.lastGuess.nickname }}
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
