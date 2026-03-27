<template>
  <div class="page page-chat">
    <div class="chat-shell">
      <aside class="sidebar">
        <div class="section">
          <div class="section-title">Диалоги</div>
          <button
            class="item"
            :class="{active: activeDialog?.kind === 'general'}"
            @click="selectGeneral"
          >
            Общий чат
          </button>
        </div>
        <div class="section">
          <div class="section-title">Пользователи</div>
          <button
            v-for="user in users"
            :key="user.id"
            class="item"
            :class="{active: activeDialog?.kind === 'private' && activeDialog?.targetUser?.id === user.id}"
            @click="selectPrivate(user)"
          >
            {{ user.nickname }}
          </button>
        </div>
      </aside>

      <main class="chat-main">
        <header class="chat-header">
          <div>
            <div class="title">
              {{ activeDialog?.title || 'Чат' }}
            </div>
            <div class="subtitle" v-if="activeDialog?.kind === 'private'">
              private message
            </div>
          </div>
          <button class="logout" @click="onLogout">Выйти</button>
        </header>

        <div class="chat-body" ref="messagesEl">
          <div v-if="historyLoading" class="hint">Загрузка...</div>
          <div v-else-if="!messages.length" class="hint">Нет сообщений</div>
          <div v-for="message in messages" :key="message.id" class="message">
            <div class="message-meta">
              <span class="author">{{ message.authorNickname }}</span>
              <span class="time">{{ new Date(message.createdAt).toLocaleTimeString() }}</span>
            </div>
            <div class="message-body">
              <template v-for="(segment, index) in linkify(message.body)" :key="index">
                <a
                  v-if="segment.type === 'link'"
                  :href="segment.value"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ segment.value }}
                </a>
                <span v-else>{{ segment.value }}</span>
              </template>
            </div>
          </div>
          <div v-if="error" class="error">{{ error }}</div>
        </div>

        <div class="chat-input">
          <textarea
            v-model="messageText"
            class="input"
            rows="2"
            placeholder="Сообщение..."
          />
          <button class="btn" @click="onSend">Отправить</button>
        </div>
      </main>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
<style src="./style-global.less" lang="less"/>
