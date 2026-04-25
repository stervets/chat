<template>
      <div v-if="imageViewerVisible" class="image-viewer" @click="onImageViewerBackdropClick">
        <button class="image-viewer-close" aria-label="Закрыть" @click="closeImageViewer">×</button>
        <img
          class="image-viewer-media"
          :src="imageViewerSrc"
          :alt="imageViewerAlt || 'image preview'"
          @click.stop
        />
      </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
