<template>
  <div class="page page-invites">
    <div class="invites-shell">
      <header class="invites-header">
        <div>
          <div class="title">Инвайты</div>
          <div class="subtitle">Нажми кнопку — ссылка сразу скопируется</div>
        </div>
        <div class="actions">
          <NuxtLink class="nav-link" to="/chat">Чат</NuxtLink>
          <button class="btn" :disabled="creating" @click="onCreate">
            Создать инвайт
          </button>
        </div>
      </header>

      <div class="invites-body">
        <div class="hint">После клика просто вставь ссылку (Ctrl+V) в чат.</div>
        <div v-if="lastLink" class="invite-link">
          <div class="label">Ссылка для приглашения</div>
          <div class="link">{{ lastLink }}</div>
        </div>
        <div v-if="copied" class="copied">Ссылка скопирована в буфер обмена.</div>
        <div v-if="error" class="error">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
