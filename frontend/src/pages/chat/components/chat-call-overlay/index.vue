<template>
  <div v-if="callPhase !== 'idle'" class="call-overlay">
    <div class="call-card" :class="`call-card-${callPhase}`">
      <audio ref="remoteAudioEl" autoplay playsinline />

      <div class="call-peer">
        <img
          v-if="callPeerAvatarUrl"
          class="call-avatar"
          :src="callPeerAvatarUrl"
          :alt="callPeerName"
        />
        <div v-else class="call-avatar call-avatar-fallback">
          {{ peerFallback }}
        </div>
        <div class="call-title">{{ callPeerName }}</div>
        <div class="call-subtitle">{{ subtitle }}</div>
        <div v-if="callError" class="call-error">{{ callError }}</div>
      </div>

      <div v-if="callPhase !== 'ended'" class="call-actions">
        <button
          v-if="callPhase === 'incoming'"
          class="call-action call-action-answer"
          type="button"
          @click="$emit('answer')"
        >
          <Phone :size="20" />
          <span>Ответить</span>
        </button>

        <button
          v-if="callPhase === 'connected' || callPhase === 'connecting'"
          class="call-action call-action-secondary"
          type="button"
          @click="$emit('toggle-mute')"
        >
          <MicOff v-if="callMuted" :size="20" />
          <Mic v-else :size="20" />
          <span>{{ callMuted ? 'Вкл. микрофон' : 'Выкл. микрофон' }}</span>
        </button>

        <button
          v-if="callPhase === 'incoming'"
          class="call-action call-action-hangup"
          type="button"
          @click="$emit('reject')"
        >
          <PhoneOff :size="20" />
          <span>Отклонить</span>
        </button>

        <button
          v-else
          class="call-action call-action-hangup"
          type="button"
          @click="$emit('hangup')"
        >
          <PhoneOff :size="20" />
          <span>Завершить</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
