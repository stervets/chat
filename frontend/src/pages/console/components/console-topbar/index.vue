<template>
  <div class="console-topbar">
    <button class="ghost-btn back-btn" @click="goBack">
      <ArrowLeft :size="16" />
      <span>Назад</span>
    </button>
    <div class="console-topbar-text">
      <div class="console-title">Console</div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
