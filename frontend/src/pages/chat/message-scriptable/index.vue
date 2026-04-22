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

    <div v-else-if="viewModel.kind === 'poll_surface'" class="scriptable-card scriptable-card-poll">
      <div class="scriptable-title">{{ viewModel.title || 'Poll' }}</div>
      <div class="scriptable-poll-question">{{ viewModel.question || 'Выберите вариант' }}</div>
      <div class="scriptable-poll-options">
        <button
          v-for="option in (viewModel.options || [])"
          :key="`poll-option-${option.index}`"
          class="scriptable-btn scriptable-poll-option-btn"
          :disabled="!!viewModel.pending"
          @click="onPollVote(option.index)"
        >
          <span class="scriptable-poll-option-label">{{ option.label }}</span>
          <span class="scriptable-poll-option-votes">{{ Number(option.votes || 0) }}</span>
        </button>
      </div>
      <div class="scriptable-meta">Голосов: {{ Number(viewModel.totalVotes || 0) }}</div>
      <div class="scriptable-meta">События комнаты: {{ Number(viewModel.chatEvents || 0) }}</div>
    </div>

    <div v-else-if="viewModel.kind === 'bot_control_surface'" class="scriptable-card scriptable-card-bot-control">
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
          @click="onBotToggle(true)"
        >
          ON
        </button>
        <button
          class="scriptable-btn scriptable-btn-compact"
          :disabled="!!viewModel.pending"
          @click="onBotToggle(false)"
        >
          OFF
        </button>
      </div>
      <div class="scriptable-bot-level-row">
        <input
          :value="botLevelDraft"
          class="scriptable-bot-level-input"
          type="range"
          min="0"
          max="100"
          step="1"
          :disabled="!!viewModel.pending"
          @input="onBotLevelInput"
        />
        <button
          class="scriptable-btn scriptable-btn-compact"
          :disabled="!!viewModel.pending"
          @click="onBotLevelSubmit"
        >
          {{ Number(botLevelDraft || viewModel.level || 0) }}%
        </button>
      </div>
      <div class="scriptable-meta">Room events: {{ Number(viewModel.chatEvents || 0) }}</div>
      <div v-if="viewModel.updatedAt" class="scriptable-meta">Updated: {{ viewModel.updatedAt }}</div>
    </div>

    <div v-else class="scriptable-fallback">
      <div class="scriptable-fallback-title">Unknown script view</div>
      <pre class="scriptable-json">{{ asJson(viewModel) }}</pre>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
