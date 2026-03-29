<template>
  <div class="page page-chat">
    <div class="chat-shell">
      <main class="chat-main">
        <header class="chat-header">
          <div>
            <div class="title">
              {{ activeDialog?.kind === 'general' ? 'Чат' : (activeDialog?.title || 'Чат') }}
            </div>
            <div class="subtitle" v-if="activeDialog?.kind === 'private'">
              директ
            </div>
          </div>
          <div class="actions">
            <button v-if="activeDialog?.kind === 'private'" class="nav-link" @click="selectGeneral">
              В чат
            </button>
            <button class="nav-link" @click="openUsers">Директы</button>
            <NuxtLink class="nav-link" to="/invites">Инвайты</NuxtLink>
            <button class="logout" @click="onLogout">Выйти</button>
          </div>
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
            @keydown="onKeydown"
          />
          <button class="btn" @click="onSend">Отправить</button>
        </div>
      </main>
    </div>

    <div v-if="showUsers" class="users-overlay" @click.self="closeUsers">
        <div class="users-panel">
          <div class="users-header">
            <div class="users-title">Директы</div>
            <button class="users-close" @click="closeUsers">Закрыть</button>
          </div>
        <input
          v-model="searchQuery"
          class="users-search"
          type="text"
          placeholder="Никнейм..."
        />
        <div v-if="!users.length" class="users-empty">Нет пользователей</div>
        <div v-else-if="!filteredUsers.length" class="users-empty">Никого не найдено</div>
        <div class="users-list">
          <button
            v-for="user in filteredUsers"
            :key="user.id"
            class="item"
            :class="{active: activeDialog?.kind === 'private' && activeDialog?.targetUser?.id === user.id}"
            @click="selectUser(user)"
          >
            {{ user.nickname }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
<style src="./style-global.less" lang="less"/>
