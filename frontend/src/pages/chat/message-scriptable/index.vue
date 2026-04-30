<template>
  <div class="scriptable-message">
    <ScriptableFallbackEmpty v-if="!viewModel" :message="message"/>

    <component
      :is="resolvedScriptableView"
      v-else-if="resolvedScriptableView"
      :view-model="viewModel"
      :guess-input="guessInput"
      :bot-level-draft="botLevelDraft"
      @action="onAction"
      @guess-input="onGuessInputValue"
      @submit="onGuessSubmit"
      @vote="onPollVote"
      @toggle="onBotToggle"
      @level-input="onBotLevelInputValue"
      @level-submit="onBotLevelSubmit"
    />

    <ScriptableFallbackUnknown v-else :view-model="viewModel"/>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less"/>
