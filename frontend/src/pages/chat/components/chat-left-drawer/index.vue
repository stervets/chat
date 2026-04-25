<template>
      <aside class="drawer drawer-left" :class="{open: leftMenuOpen}">
        <div class="drawer-head">
          <div class="drawer-title">Навигация</div>
          <button class="drawer-close" @click="onCloseLeftMenuClick">Закрыть</button>
        </div>

        <div class="drawer-layout">
          <div v-if="me" class="drawer-profile">
            <div class="drawer-profile-main">
              <img
                v-if="me.avatarUrl"
                class="nav-avatar"
                :src="me.avatarUrl"
                :alt="me.name || me.nickname"
              />
              <div v-else class="nav-avatar nav-avatar-fallback">
                {{ ((me.name || me.nickname || '?').trim().charAt(0) || '?').toUpperCase() }}
              </div>
              <div class="drawer-profile-text">
                <div class="drawer-profile-name" :style="getUserNameStyle(me)">
                  <span v-if="isSystemUser(me)" class="system-star">★</span>
                  <span v-if="hasDonationBadge(me)" class="donation-star" :style="getDonationBadgeStyle(me)">⭐</span>
                  {{ me.name }}
                </div>
                <div class="drawer-profile-username">{{ formatUsername(me.nickname) }}</div>
              </div>
            </div>
          </div>

          <div class="left-nav-tabs">
            <button class="left-nav-tab" :class="{active: localLeftNavMode === 'directs'}" @click="localLeftNavMode = 'directs'">
              Директы
            </button>
            <button class="left-nav-tab" :class="{active: localLeftNavMode === 'rooms'}" @click="localLeftNavMode = 'rooms'">
              Комнаты
            </button>
          </div>

          <div v-if="localLeftNavMode === 'directs'" class="drawer-fixed drawer-fixed-top">
            <input
              v-model="localSearchQuery"
              class="users-search"
              type="text"
              placeholder="Найти директ или пользователя..."
            />
          </div>

          <div v-else class="drawer-fixed drawer-fixed-top">
            <input
              v-model="localRoomSearchQuery"
              class="users-search"
              type="text"
              placeholder="Найти комнату..."
            />
          </div>

          <div class="left-nav-scroll">
            <template v-if="localLeftNavMode === 'directs'">
              <div class="menu-list">
                <div v-if="!filteredDirectDialogs.length" class="hint">Пока нет директов</div>
                <button
                  v-for="dialog in filteredDirectDialogs"
                  :key="dialog.roomId"
                  class="menu-item"
                  :class="{
                    active: activeDialog?.kind === 'direct' && activeDialog?.targetUser?.id === dialog.targetUser.id,
                    'menu-item-unread': isDirectDialogUnread(dialog.roomId),
                  }"
                  @click="selectDirectDialog(dialog)"
                >
                  <img
                    v-if="dialog.targetUser.avatarUrl"
                    class="nav-avatar nav-avatar-sm"
                    :src="dialog.targetUser.avatarUrl"
                    :alt="dialog.targetUser.name"
                  />
                  <div v-else class="nav-avatar nav-avatar-fallback nav-avatar-sm">
                    {{ ((dialog.targetUser.name || dialog.targetUser.nickname || '?').trim().charAt(0) || '?').toUpperCase() }}
                  </div>
                  <div class="menu-item-text">
                    <span class="name" :style="getUserNameStyle(dialog.targetUser)">
                      <span v-if="isSystemUser(dialog.targetUser)" class="system-star">★</span>
                      <span
                        v-if="hasDonationBadge(dialog.targetUser)"
                        class="donation-star"
                        :style="getDonationBadgeStyle(dialog.targetUser)"
                      >⭐</span>
                      {{ dialog.targetUser.name }}
                    </span>
                    <span class="nickname">{{ formatUsername(dialog.targetUser.nickname) }}</span>
                  </div>
                  <span v-if="isDirectDialogUnread(dialog.roomId)" class="direct-unread-dot"/>
                </button>
              </div>

              <div v-if="localSearchQuery.trim()" class="section-title">Пользователи</div>
              <div v-if="localSearchQuery.trim() && !filteredUsers.length" class="hint">Ничего не найдено</div>
              <div class="menu-list users-list">
                <button
                  v-for="user in filteredUsers"
                  :key="`search-${user.id}`"
                  class="menu-item user-item"
                  :class="{active: activeDialog?.kind === 'direct' && activeDialog?.targetUser?.id === user.id}"
                  @click="selectUser(user)"
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
                </button>
              </div>
            </template>

            <template v-else>
              <div class="section-title">Мои комнаты</div>
              <div class="menu-list">
                <button
                  v-for="dialog in filteredJoinedRooms"
                  :key="`joined-${dialog.id}`"
                  class="menu-item"
                  :class="{active: activeDialog?.kind !== 'direct' && activeDialog?.id === dialog.id}"
                  @click="selectRoomDialog(dialog)"
                >
                  <img
                    v-if="resolveDialogAvatarUrl(dialog)"
                    class="nav-avatar nav-avatar-sm"
                    :src="resolveDialogAvatarUrl(dialog)"
                    :alt="dialog.title || 'Комната'"
                  />
                  <div v-else class="nav-avatar nav-avatar-fallback nav-avatar-sm">
                    {{ getDialogAvatarFallback(dialog) }}
                  </div>
                  <div class="menu-item-text">
                    <span class="name">{{ dialog.title }}</span>
                  </div>
                </button>
              </div>

              <div v-if="filteredPublicRooms.length" class="section-title">Публичные</div>
              <div class="menu-list">
                <div
                  v-for="dialog in filteredPublicRooms"
                  :key="`public-${dialog.id}`"
                  class="menu-item menu-item-public-room"
                >
                  <img
                    v-if="resolveDialogAvatarUrl(dialog)"
                    class="nav-avatar nav-avatar-sm"
                    :src="resolveDialogAvatarUrl(dialog)"
                    :alt="dialog.title || 'Комната'"
                  />
                  <div v-else class="nav-avatar nav-avatar-fallback nav-avatar-sm">
                    {{ getDialogAvatarFallback(dialog) }}
                  </div>
                  <div class="menu-item-text">
                    <span class="name">{{ dialog.title }}</span>
                  </div>
                  <button class="ghost-btn room-join-btn" @click="joinPublicRoom(dialog)">Войти</button>
                </div>
              </div>
            </template>
          </div>

          <div class="drawer-fixed drawer-fixed-bottom">
            <button class="menu-logout" @click="onLogout">Выйти</button>
          </div>
        </div>
      </aside>

</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
