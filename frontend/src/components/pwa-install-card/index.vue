<template>
  <section v-if="shouldRender" class="pwa-install-card">
    <div class="pwa-head">Установить MARX на рабочий стол</div>
    <button
      v-if="showInstallButton"
      class="pwa-action"
      type="button"
      @click="onInstall"
    >
      Установить MARX
    </button>

    <div v-else-if="showIosHelperButton" class="pwa-ios-wrap">
      <button class="pwa-action pwa-action-secondary" type="button" @click="toggleIosInstructions">
        {{ showIosInstructions ? 'Скрыть инструкцию' : 'Как установить на iPhone' }}
      </button>
      <p v-if="showIosInstructions" class="pwa-note">
        Открой в Safari меню «Поделиться» и выбери «На экран Домой».
      </p>
    </div>

    <div v-else-if="showTelegramHelperButton" class="pwa-ios-wrap">
      <button class="pwa-action pwa-action-secondary" type="button" @click="toggleInstallFallback">
        {{ showInstallFallback ? 'Скрыть инструкцию' : 'Как установить из Telegram' }}
      </button>
      <p v-if="showInstallFallback" class="pwa-note">
        Встроенный браузер Telegram не устанавливает PWA. Открой страницу во внешнем браузере и выбери «Добавить на экран Домой».
      </p>
    </div>

    <p v-else-if="showIosNonSafariHint" class="pwa-note">
      Для установки открой MARX в Safari, потом «Поделиться» → «На экран Домой».
    </p>
  </section>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
