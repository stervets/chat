<template>
  <div class="page page-invite">
    <div class="content">
      <h1>Invite</h1>
      <p>Код: <span class="code">{{ code }}</span></p>
      <div class="form">
        <input
          v-model="nickname"
          type="text"
          placeholder="nickname"
          class="input"
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
          @keydown="onKeydown"
        />
        <button class="btn" :disabled="loading" @click="onRegister">
          {{ loading ? 'Регистрация...' : 'Register' }}
        </button>
        <div v-if="error" class="error">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
<style src="./style-global.less" lang="less"/>
