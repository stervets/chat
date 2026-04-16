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
        <div class="form">
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
