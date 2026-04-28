<template>
  <div class="console-topbar">
    <button class="ghost-btn back-btn" @click="goBack">
      <ArrowLeft :size="16" />
      <span>Назад</span>
    </button>
    <div class="console-topbar-text">
      <button
        v-if="!isInstalled"
        class="ghost-btn install-app-btn"
        type="button"
        :disabled="installBusy"
        @click="onInstallClick"
      >
        <Download :size="16" />
        <span>{{ installBusy ? 'Устанавливаем...' : 'Установить приложение' }}</span>
      </button>
      <div v-else class="console-title">Консоль</div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
