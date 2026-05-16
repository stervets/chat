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
          <button class="btn" type="button" @click="onReservePromptYes">Да</button>
          <button class="ghost-btn" type="button" @click="onReservePromptNo">Нет</button>
          <button class="ghost-btn" type="button" @click="onReservePromptNever">Больше не предлагать</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script src="./app.script.ts" lang="ts"/>
<style src="./app.style.less" lang="less"/>
