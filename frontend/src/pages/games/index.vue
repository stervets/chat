<template>
  <div class="page page-games-lobby">
    <div class="lobby-shell">
      <header class="lobby-header">
        <h1>Игры</h1>
        <button class="back-btn" @click="goBackToChat">В чат</button>
      </header>

      <section class="game-card">
        <div class="game-card-title">King</div>
        <div class="game-card-subtitle">Solo MVP: ты + 3 бота</div>
        <button class="play-btn" :disabled="createPending" @click="createSoloKing">
          {{ createPending ? 'Создаю матч...' : 'Играть с ботами' }}
        </button>
        <div v-if="error" class="error">{{ error }}</div>
      </section>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
