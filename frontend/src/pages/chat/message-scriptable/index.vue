<template>
  <div class="scriptable-message">
    <ScriptableFallbackEmpty v-if="!viewModel" :message="message"/>

    <component
      :is="resolvedScriptableView"
      v-else-if="resolvedScriptableView"
      v-bind="resolvedScriptableViewProps"
      @action="onAction"
    />

    <ScriptableFallbackUnknown v-else :view-model="viewModel"/>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
