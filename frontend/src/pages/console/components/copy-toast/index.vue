<template>
  <div v-if="copyToastVisible" class="console-copy-toast">
    {{ copyToastText }}
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
