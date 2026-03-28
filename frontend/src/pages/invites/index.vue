<template>
  <div class="page page-invites">
    <div class="invites-shell">
      <header class="invites-header">
        <div>
          <div class="title">Инвайты</div>
          <div class="subtitle">Личный список кодов приглашений</div>
        </div>
        <div class="actions">
          <NuxtLink class="nav-link" to="/chat">Чат</NuxtLink>
          <button class="btn" :disabled="creating" @click="onCreate">
            Создать инвайт
          </button>
        </div>
      </header>

      <div class="invites-body">
        <div v-if="loading" class="hint">Загрузка...</div>
        <div v-else-if="!invites.length" class="hint">Инвайтов нет</div>
        <div v-else class="invites-list">
          <div v-for="invite in invites" :key="invite.id" class="invite">
            <div class="code">{{ invite.code }}</div>
            <div class="meta">
              <span class="status" :class="{used: invite.isUsed}">
                {{ invite.isUsed ? 'Использован' : 'Свободен' }}
              </span>
              <span>Создан: {{ formatDate(invite.createdAt) }}</span>
              <span v-if="invite.usedAt">Использован: {{ formatDate(invite.usedAt) }}</span>
              <span v-if="invite.usedBy">
                Пользователь: {{ invite.usedBy.nickname }} (#{{ invite.usedBy.id }})
              </span>
            </div>
          </div>
        </div>
        <div v-if="error" class="error">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
