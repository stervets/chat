<template>
  <div class="console-topbar">
    <button class="ghost-btn back-btn" @click="goBack">
      <ArrowLeft :size="16" />
      <span>Назад</span>
    </button>
    <div class="console-topbar-text">
      <button
        v-if="!isInstalled && !isTelegramInApp"
        class="ghost-btn install-app-btn"
        type="button"
        :disabled="installBusy"
        @click="onInstallClick"
      >
        <Download :size="16" />
        <span>{{ installBusy ? 'Устанавливаем...' : 'Установить приложение' }}</span>
      </button>
      <div v-else-if="!isInstalled && isTelegramInApp" class="install-app-warning">
        Для установки приложения открой сайт
        <a href="https://marx.core5.ru" target="_blank" rel="noopener noreferrer">https://marx.core5.ru</a>
        во внешнем браузере.
      </div>
      <div v-else class="console-title">Консоль</div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
