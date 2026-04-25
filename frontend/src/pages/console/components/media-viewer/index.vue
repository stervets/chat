<template>
  <div v-if="mediaViewerVisible" class="media-viewer-overlay" @click.self="closeMediaViewer">
    <button class="media-viewer-close" type="button" @click="closeMediaViewer">Закрыть</button>
    <img class="media-viewer-image" :src="mediaViewerSrc" :alt="mediaViewerAlt || 'image'" />
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
