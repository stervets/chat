<template>
  <div class="page page-invite">
    <div class="invite-shell">
      <img
        class="project-logo"
        src="/marx_logo.png"
        alt="MARX logo"
        loading="eager"
        decoding="async"
      />
      <div class="content">
        <h1>Invite</h1>
        <p>Код: <span class="code">{{ code }}</span></p>
        <div v-if="isTelegramMode" class="telegram-warning">
          <p class="telegram-warning-text">
            Если Вы открыли эту ссылку через Telegram, откройте её в обычном браузере!
          </p>
          <a
            class="telegram-warning-link"
            :href="openInBrowserUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ openInBrowserUrl }}
          </a>
          <button class="telegram-warning-btn" type="button" @click="onOpenInBrowserClick">
            Попробовать открыть в браузере
          </button>
        </div>
        <div class="form">
          <template v-if="existingUserApplied">
            <div class="hint">{{ existingUserMessage }}</div>
            <button class="btn" :disabled="loading" @click="onGoChat">
              {{ loading ? 'Переход...' : 'В чат' }}
            </button>
          </template>
          <template v-else>
            <input
              v-model="nickname"
              type="text"
              placeholder="nickname"
              class="input"
              :disabled="inviteChecking || !inviteValid || loading"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              @keydown="onKeydown"
            />
            <input
              v-model="password"
              type="password"
              placeholder="password"
              class="input"
              :disabled="inviteChecking || !inviteValid || loading"
              @keydown="onKeydown"
            />
            <button class="btn" :disabled="loading || inviteChecking || !inviteValid" @click="onRegister">
              {{ loading ? 'Регистрация...' : 'Register' }}
            </button>
          </template>
          <div v-if="inviteChecking" class="hint">Проверяю инвайт...</div>
          <div v-if="error" class="error">{{ error }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
<style src="./style-global.less" lang="less"/>
