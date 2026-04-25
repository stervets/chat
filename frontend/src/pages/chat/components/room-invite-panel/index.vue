<template>
          <div v-if="roomInviteOpen && isActiveDialogAdmin && activeDialog?.kind !== 'direct'" class="room-invite-panel">
            <div class="room-invite-head">
              <div class="room-invite-title">Пригласить в комнату</div>
              <button class="ghost-btn" @click="toggleRoomInvitePanel">Закрыть</button>
            </div>
            <input
              v-model="localRoomInviteSearchQuery"
              class="users-search"
              type="text"
              placeholder="Контакты или поиск пользователей..."
            />
            <div v-if="roomInviteLoading" class="hint">Загрузка...</div>
            <div v-else class="room-invite-body">
              <div v-if="filteredRoomInviteContacts.length" class="room-invite-section">
                <div class="section-title">Контакты</div>
                <button
                  v-for="user in filteredRoomInviteContacts"
                  :key="`room-invite-contact-${user.id}`"
                  class="menu-item room-invite-user"
                  :class="{active: isRoomInviteSelected(user.id)}"
                  @click="toggleRoomInviteSelection(user.id)"
                >
                  <img
                    v-if="user.avatarUrl"
                    class="nav-avatar nav-avatar-sm"
                    :src="user.avatarUrl"
                    :alt="user.name"
                  />
                  <div v-else class="nav-avatar nav-avatar-fallback nav-avatar-sm">
                    {{ ((user.name || user.nickname || '?').trim().charAt(0) || '?').toUpperCase() }}
                  </div>
                  <div class="menu-item-text">
                    <span class="name" :style="getUserNameStyle(user)">
                      <span v-if="isSystemUser(user)" class="system-star">★</span>
                      <span v-if="hasDonationBadge(user)" class="donation-star" :style="getDonationBadgeStyle(user)">⭐</span>
                      {{ user.name }}
                    </span>
                    <span class="nickname">{{ formatUsername(user.nickname) }}</span>
                  </div>
                  <span class="room-invite-check">{{ isRoomInviteSelected(user.id) ? '✓' : '+' }}</span>
                </button>
              </div>

              <div v-if="localRoomInviteSearchQuery.trim() && filteredRoomInviteUsers.length" class="room-invite-section">
                <div class="section-title">Поиск</div>
                <button
                  v-for="user in filteredRoomInviteUsers"
                  :key="`room-invite-user-${user.id}`"
                  class="menu-item room-invite-user"
                  :class="{active: isRoomInviteSelected(user.id)}"
                  @click="toggleRoomInviteSelection(user.id)"
                >
                  <img
                    v-if="user.avatarUrl"
                    class="nav-avatar nav-avatar-sm"
                    :src="user.avatarUrl"
                    :alt="user.name"
                  />
                  <div v-else class="nav-avatar nav-avatar-fallback nav-avatar-sm">
                    {{ ((user.name || user.nickname || '?').trim().charAt(0) || '?').toUpperCase() }}
                  </div>
                  <div class="menu-item-text">
                    <span class="name" :style="getUserNameStyle(user)">
                      <span v-if="isSystemUser(user)" class="system-star">★</span>
                      <span v-if="hasDonationBadge(user)" class="donation-star" :style="getDonationBadgeStyle(user)">⭐</span>
                      {{ user.name }}
                    </span>
                    <span class="nickname">{{ formatUsername(user.nickname) }}</span>
                  </div>
                  <span class="room-invite-check">{{ isRoomInviteSelected(user.id) ? '✓' : '+' }}</span>
                </button>
              </div>

              <div
                v-if="!filteredRoomInviteContacts.length && (!localRoomInviteSearchQuery.trim() || !filteredRoomInviteUsers.length)"
                class="hint"
              >
                Нечего показывать. Ищи пользователя или добавь контакты.
              </div>
            </div>
            <div v-if="roomInviteError" class="error">{{ roomInviteError }}</div>
            <div class="room-invite-actions">
              <div class="hint">Выбрано: {{ roomInviteSelectedIds.length }}</div>
              <button
                class="composer-format-btn"
                :disabled="roomInviteLoading || !roomInviteSelectedIds.length"
                @click="submitRoomInvite"
              >
                {{ roomInviteLoading ? 'Добавляю...' : 'Добавить' }}
              </button>
            </div>
          </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
