<template>
  <div class="scriptable-message">
    <div v-if="!viewModel" class="scriptable-fallback">
      <div class="scriptable-fallback-title">Scriptable message</div>
      <div class="scriptable-fallback-body">{{ message.rawText }}</div>
    </div>

    <div v-else-if="viewModel.kind === 'button_sound'" class="scriptable-card scriptable-card-button">
      <div class="scriptable-title">{{ viewModel.title || 'Локальный виджет' }}</div>
      <button
        class="scriptable-btn"
        :class="{'scriptable-btn-pulse': !!viewModel.pulse}"
        @click="onAction('click')"
      >
        {{ viewModel.buttonLabel || 'Click' }}
      </button>
      <div class="scriptable-meta">Локальных кликов: {{ Number(viewModel.clicks || 0) }}</div>
    </div>

    <div v-else-if="viewModel.kind === 'guess_word'" class="scriptable-card scriptable-card-guess">
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
          @keydown.enter.prevent="onGuessSubmit"
        />
        <button
          class="scriptable-btn scriptable-btn-compact"
          :disabled="!!viewModel.pending"
          @click="onGuessSubmit"
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

    <div v-else class="scriptable-fallback">
      <div class="scriptable-fallback-title">Unknown script view</div>
      <pre class="scriptable-json">{{ asJson(viewModel) }}</pre>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
