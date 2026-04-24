<template>
  <div class="page page-error">
    <div class="error-shell">
      <img
        class="project-logo"
        src="/marx_logo.png"
        alt="MARX logo"
        loading="eager"
        decoding="async"
      />
      <div class="content">
        <div class="code">{{ statusCode }}</div>
        <h1>{{ titleText }}</h1>
        <p>{{ descriptionText }}</p>

        <div class="actions">
          <button class="btn" type="button" @click="onGoHome">Назад</button>
          <button class="btn btn-ghost" type="button" @click="onRetry">Обновить</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script src="./error.script.ts" lang="ts"/>
<style src="./error.style.less" lang="less" scoped/>
