<template>
        <div v-if="toasts.length" class="toast-stack">
          <div
            v-for="toast in toasts"
            :key="toast.id"
            class="toast-item"
            :class="{'toast-item-clickable': isToastClickable(toast)}"
            @click="onToastClick(toast)"
          >
            <div class="toast-head">
              <span class="toast-title">{{ toast.title }}</span>
              <button class="toast-close" @click.stop="removeToast(toast.id)">×</button>
            </div>
            <div class="toast-body">{{ toast.body }}</div>
          </div>
        </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
