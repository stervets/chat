<template>
  <div class="page page-king-match">
    <div class="match-shell" v-if="session && state && mePlayer">
      <header class="match-header">
        <div class="match-title-wrap">
          <div class="match-title">King</div>
          <div class="match-round">{{ roundLabel }}</div>
        </div>
        <button class="back-btn" @click="goToLobby">Лобби</button>
      </header>

      <section class="score-strip">
        <div
          v-for="item in seatOrder"
          :key="`score-${item.seat}`"
          class="score-item"
          :class="{current: state.currentSeat === item.seat}"
        >
          <span class="score-name">{{ playerNameBySeat(item.seat) }}</span>
          <span class="score-total">{{ totalScoreBySeat(item.seat) }}</span>
        </div>
      </section>

      <section class="opponents-strip">
        <div
          v-for="item in opponents"
          :key="`opp-${item.seat}`"
          class="opponent-pill"
          :class="{turn: state.currentSeat === item.seat}"
        >
          <div class="opponent-name">{{ item.user.name }}</div>
          <div class="opponent-cards">{{ cardsCountBySeat(item.seat) }} карт</div>
        </div>
      </section>

      <section class="trick-area">
        <div class="trick-meta">
          <span>Козырь: {{ trumpLabel }}</span>
          <span>Взятка: {{ state.completedTricksCount + 1 }}/8</span>
        </div>

        <div class="trick-grid">
          <div class="trick-slot top">
            <div class="slot-name">{{ playerNameBySeat(topSeat) }}</div>
            <img class="card" :src="cardBySeat(topSeat)" alt="top card"/>
          </div>

          <div class="trick-slot left">
            <div class="slot-name">{{ playerNameBySeat(leftSeat) }}</div>
            <img class="card" :src="cardBySeat(leftSeat)" alt="left card"/>
          </div>

          <div class="trick-slot right">
            <div class="slot-name">{{ playerNameBySeat(rightSeat) }}</div>
            <img class="card" :src="cardBySeat(rightSeat)" alt="right card"/>
          </div>

          <div class="trick-slot bottom">
            <div class="slot-name">{{ playerNameBySeat(bottomSeat) }}</div>
            <img class="card" :src="cardBySeat(bottomSeat)" alt="bottom card"/>
          </div>
        </div>
      </section>

      <section class="action-area" :class="{active: isMyTurn}">
        <div class="action-main">{{ isMyTurn ? 'Твой ход' : 'Жди ход' }}</div>
        <div class="action-sub">{{ actionHint }}</div>
      </section>

      <section class="hand-area">
        <div class="hand-scroll">
          <button
            v-for="card in myHand"
            :key="cardKey(card)"
            class="hand-card"
            :class="{selected: selectedCardKey === cardKey(card)}"
            @click="selectCard(card)"
          >
            <img :src="kingCardImage(card)" :alt="cardKey(card)"/>
          </button>
        </div>
        <button
          class="play-btn"
          :disabled="!canPlaySelected"
          @click="playSelectedCard"
        >
          Сыграть
        </button>
      </section>

      <section class="chat-sheet" :class="{open: chatOpen}">
        <button class="chat-toggle" @click="toggleChat">
          {{ chatOpen ? 'Скрыть чат' : `Чат (${chatMessages.length})` }}
        </button>

        <div v-if="chatOpen" class="chat-content">
          <div class="chat-list">
            <div
              v-for="message in chatMessages"
              :key="`gm-${message.id}`"
              class="chat-message"
            >
              <span class="author" :style="{color: message.authorNicknameColor || undefined}">
                {{ message.authorName }}:
              </span>
              <span class="text">{{ message.rawText }}</span>
            </div>
          </div>
          <div class="chat-send">
            <input
              v-model="chatInput"
              type="text"
              placeholder="Сообщение в комнату"
              @keydown.enter.prevent="sendChat"
            />
            <button :disabled="chatSendPending" @click="sendChat">Отправить</button>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="state-screen">
      <div v-if="loading">Загрузка матча...</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <button v-if="!loading" class="back-btn" @click="goToLobby">Назад</button>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
