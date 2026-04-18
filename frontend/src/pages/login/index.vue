<template>
  <div class="page page-login">
    <div class="login-shell">
      <img
        class="project-logo"
        src="/marx_logo.png"
        alt="MARX logo"
        loading="eager"
        decoding="async"
      />
      <div class="content">
        <h1>Вход</h1>
        <form class="form" autocomplete="on" @submit.prevent="onLogin">
          <input
            v-model="nickname"
            type="text"
            placeholder="nickname"
            name="nickname"
            id="login-nickname"
            class="input"
            autocapitalize="none"
            autocorrect="off"
            autocomplete="username"
            spellcheck="false"
            @keydown="onKeydown"
          />
          <input
            v-model="password"
            type="password"
            placeholder="password"
            name="password"
            id="login-password"
            class="input"
            autocomplete="current-password"
            @keydown="onKeydown"
          />
          <button class="btn" :disabled="loading" type="submit">
            {{ loading ? 'Вход...' : 'Login' }}
          </button>
          <div v-if="error" class="error">{{ error }}</div>
        </form>

        <div class="pwa-install-wrap">
          <PwaInstallCard/>
        </div>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
<style src="./style-global.less" lang="less"/>
