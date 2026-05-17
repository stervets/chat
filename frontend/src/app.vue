<template>
  <div class="application">
    <NuxtLayout
      :name="layout"
      class="layout"
    >
      <NuxtPage/>
    </NuxtLayout>
    <div v-if="reservePromptVisible" class="reserve-prompt-overlay">
      <div class="reserve-prompt">
        <div class="reserve-prompt-title">Подключить резервный канал?</div>
        <div class="reserve-prompt-actions">
          <button class="reserve-prompt-btn reserve-prompt-btn-primary" type="button" @click="onReservePromptYes">Да</button>
          <button class="reserve-prompt-btn reserve-prompt-btn-ghost" type="button" @click="onReservePromptNo">Нет</button>
          <button class="reserve-prompt-btn reserve-prompt-btn-ghost" type="button" @click="onReservePromptNever">Больше не предлагать</button>
        </div>
      </div>
    </div>
    <div v-if="primaryPromptVisible" class="reserve-prompt-overlay">
      <div class="reserve-prompt">
        <div class="reserve-prompt-title">Основной канал доступен. Переключиться на него?</div>
        <div class="reserve-prompt-actions">
          <button class="reserve-prompt-btn reserve-prompt-btn-primary" type="button" @click="onPrimaryPromptYes">Да</button>
          <button class="reserve-prompt-btn reserve-prompt-btn-ghost" type="button" @click="onPrimaryPromptNo">Нет</button>
          <button class="reserve-prompt-btn reserve-prompt-btn-ghost" type="button" @click="onPrimaryPromptNever">Больше не спрашивать</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script src="./app.script.ts" lang="ts"/>
<style src="./app.style.less" lang="less"/>
