<template>
  <div class="scriptable-fallback">
    <div class="scriptable-fallback-title">Unknown script view</div>
    <pre class="scriptable-json">{{ asJson(viewModel) }}</pre>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
