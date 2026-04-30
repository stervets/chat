<template>
  <div class="scriptable-card scriptable-card-button">
    <div class="scriptable-title">{{ viewModel.title || 'Локальный виджет' }}</div>
    <button
      class="scriptable-btn"
      :class="{'scriptable-btn-pulse': !!viewModel.pulse}"
      @click="emitAction('click')"
    >
      {{ viewModel.buttonLabel || 'Click' }}
    </button>
    <div class="scriptable-meta">Локальных кликов: {{ Number(viewModel.clicks || 0) }}</div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
