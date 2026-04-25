<template>
  <div v-if="avatarCropVisible" class="avatar-crop-overlay" @click.self="onAvatarCropOverlayClick">
    <div class="avatar-crop-card">
      <div class="section-title avatar-crop-title">Выбери область аватарки</div>
      <div class="avatar-crop-stage" @pointerdown.prevent="onAvatarCropPointerDown">
        <img
          v-if="avatarCropSourceUrl"
          class="avatar-crop-image"
          :src="avatarCropSourceUrl"
          :style="avatarCropImageStyle"
          alt="avatar crop"
          draggable="false"
        />
        <div class="avatar-crop-mask" />
      </div>
      <div class="avatar-crop-controls">
        <input
          class="avatar-crop-range"
          type="range"
          :min="avatarCropMinScale"
          :max="avatarCropMaxScale"
          :step="Math.max(avatarCropMinScale / 100, 0.001)"
          :value="avatarCropScale"
          @input="onAvatarCropScaleInput"
        />
        <span class="hint">Масштаб: {{ avatarCropScalePercent }}%</span>
      </div>
      <div class="action-row">
        <button class="ghost-btn" type="button" :disabled="avatarCropBusy" @click="closeAvatarCropper">Отмена</button>
        <button class="btn" type="button" :disabled="avatarCropBusy" @click="finalizeAvatarCropAndUpload">
          <Save :size="16" />
          <span>{{ avatarCropBusy ? 'Сохраняю...' : 'Применить' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
