<template>
  <div class="page page-chat">
    <div class="chat-shell">
      <aside class="drawer drawer-left" :class="{open: leftMenuOpen}">
        <div class="drawer-head">
          <div class="drawer-title">Навигация</div>
          <button class="drawer-close" @click="closeLeftMenu">Закрыть</button>
        </div>

        <div v-if="me" class="drawer-profile">
          <div class="drawer-profile-name" :style="getUserNameStyle(me)">{{ me.name }}</div>
          <div class="drawer-profile-username">{{ formatUsername(me.nickname) }}</div>
        </div>

        <button
          class="menu-item"
          :class="{active: activeDialog?.kind === 'general'}"
          @click="selectGeneral"
        >
          Общий чат
        </button>

        <div class="section-title">Директы</div>
        <div v-if="!directDialogs.length" class="hint">Пока нет сообщений в директах</div>
        <div class="menu-list">
          <button
            v-for="dialog in directDialogs"
            :key="dialog.dialogId"
            class="menu-item"
            :class="{active: activeDialog?.kind === 'private' && activeDialog?.targetUser?.id === dialog.targetUser.id}"
            @click="selectDirectDialog(dialog)"
          >
            <span class="name" :style="getUserNameStyle(dialog.targetUser)">{{ dialog.targetUser.name }}</span>
            <span class="nickname">{{ formatUsername(dialog.targetUser.nickname) }}</span>
          </button>
        </div>

        <div class="section-title">Поиск пользователей</div>
        <input
          v-model="searchQuery"
          class="users-search"
          type="text"
          placeholder="Найти пользователя..."
        />
        <div v-if="searchQuery.trim() && !filteredUsers.length" class="hint">Ничего не найдено</div>
        <div class="menu-list users-list">
          <button
            v-for="user in filteredUsers"
            :key="`search-${user.id}`"
            class="menu-item user-item"
            :class="{active: activeDialog?.kind === 'private' && activeDialog?.targetUser?.id === user.id}"
            @click="selectUser(user)"
          >
            <span class="name" :style="getUserNameStyle(user)">{{ user.name }}</span>
            <span class="nickname">{{ formatUsername(user.nickname) }}</span>
          </button>
        </div>

        <NuxtLink class="menu-link" to="/invites">Инвайты</NuxtLink>
        <button class="menu-logout" @click="onLogout">Выйти из аккаунта</button>
      </aside>

      <div v-if="isCompactLayout && leftMenuOpen" class="drawer-backdrop" @click="closeLeftMenu"/>
      <div v-if="isCompactLayout && rightMenuOpen" class="drawer-backdrop" @click="closeRightMenu"/>

      <main
        class="chat-main"
        :class="{
          'chat-main-general': activeDialog?.kind !== 'private',
          'chat-main-private': activeDialog?.kind === 'private',
        }"
      >
        <header class="chat-header">
          <button class="icon-btn" @click="toggleLeftMenu">☰</button>
          <button
            v-if="activeDialog?.kind === 'private'"
            class="header-center-btn"
            @click="onGoToGeneralChat"
          >
            Общий чат
          </button>
          <div class="header-text">
            <div class="title">
              {{ activeDialog?.kind === 'general' ? 'Общий чат' : (activeDialog?.title || 'Чат') }}
            </div>
            <div class="subtitle" v-if="activeDialog?.kind === 'private'">
              директ
            </div>
          </div>
          <button
            v-if="activeDialog?.kind === 'private'"
            class="icon-btn delete-direct-btn"
            :disabled="directDeletePending"
            title="Удалить директ"
            @click="onDeleteActiveDirect"
          >
            🗑
          </button>
          <button
            ref="notificationButtonEl"
            class="icon-btn notify-btn"
            @click.stop="toggleNotificationsMenu"
          >
            <svg class="notify-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 4a4 4 0 0 0-4 4v2.4c0 .8-.3 1.6-.9 2.2L5.2 14.5c-.6.6-.2 1.5.7 1.5h12.2c.9 0 1.3-.9.7-1.5l-1.9-1.9a3.1 3.1 0 0 1-.9-2.2V8a4 4 0 0 0-4-4Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M10 18a2 2 0 0 0 4 0"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
              />
            </svg>
            <span v-if="unreadNotificationsCount" class="notify-badge">
              {{ unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount }}
            </span>
          </button>
          <button class="icon-btn" @click="toggleRightMenu">⚙</button>
          <div
            v-if="notificationsMenuOpen"
            ref="notificationMenuEl"
            class="notifications-menu"
            @click.stop
          >
            <div class="notifications-head">Уведомления</div>
            <div v-if="!notifications.length" class="hint">Пока пусто</div>
            <button
              v-for="notification in notifications"
              :key="notification.id"
              class="notification-item"
              :class="{'notification-item-unread': notification.unread}"
              @click="openNotification(notification)"
            >
              <div class="notification-top">
                <span class="notification-dialog">{{ getNotificationDialogTitle(notification) }}</span>
                <span class="notification-time">{{ formatMessageTime(notification.createdAt) }}</span>
              </div>
              <div class="notification-author" :style="{color: notification.authorNicknameColor || undefined}">
                {{ notification.authorName }}
              </div>
              <div class="notification-body">{{ getNotificationBodyPreview(notification) }}</div>
            </button>
          </div>
        </header>
        <div v-if="toasts.length" class="toast-stack">
          <div v-for="toast in toasts" :key="toast.id" class="toast-item">
            <div class="toast-head">
              <span class="toast-title">{{ toast.title }}</span>
              <button class="toast-close" @click="removeToast(toast.id)">×</button>
            </div>
            <div class="toast-body">{{ toast.body }}</div>
          </div>
        </div>

        <div class="chat-body" ref="messagesEl" @scroll="onMessagesScroll">
          <div v-if="historyLoading" class="hint">Загрузка...</div>
          <div v-else-if="!messages.length" class="hint">Нет сообщений</div>
          <div
            v-for="(message, messageIndex) in messages"
            :key="message.id"
            class="message"
            :class="{
              'message-own': me?.id === message.authorId,
              'message-mention-me': isMentionedForMe(message),
              'message-blink-target': blinkMessageId === message.id,
            }"
            :data-message-id="message.id"
          >
            <div class="message-meta">
              <span
                class="author message-meta-action"
                :style="getAuthorStyle(message)"
                @click="onAuthorClick(message)"
              >
                {{ message.authorName }}
              </span>
              <span class="nickname message-meta-action" @click="onAuthorClick(message)">
                {{ formatUsername(message.authorNickname) }}
              </span>
              <span
                v-if="canOpenDirectFromMessage(message)"
                class="direct-jump message-meta-action"
                title="Открыть директ"
                @click="onDirectFromMessageClick(message)"
              >
                ↗
              </span>
              <span class="time message-meta-action" @click="onMessageTimeClick(message)">
                {{ formatMessageTime(message.createdAt) }}
              </span>
              <button
                v-if="isOwnMessage(message) && editingMessageId !== message.id"
                class="message-inline-btn"
                :disabled="messageActionPendingId === message.id"
                @click="startMessageEdit(message)"
              >
                ред.
              </button>
              <button
                v-if="isOwnMessage(message) && editingMessageId !== message.id"
                class="message-inline-btn message-inline-btn-danger"
                :disabled="messageActionPendingId === message.id"
                @click="deleteOwnMessage(message)"
              >
                удал.
              </button>
            </div>
            <div v-if="editingMessageId === message.id" class="message-edit">
              <textarea
                v-model="editingMessageText"
                class="message-edit-input"
                rows="3"
                @keydown="onEditMessageKeydown($event, message)"
              />
              <div class="message-edit-actions">
                <button class="ghost-btn message-edit-cancel" @click="cancelMessageEdit">Отмена</button>
                <button
                  class="btn message-edit-save"
                  :disabled="messageActionPendingId === message.id"
                  @click="saveMessageEdit(message)"
                >
                  Сохранить
                </button>
              </div>
            </div>
            <div v-else class="message-body">
              <template
                v-for="(segment, index) in buildMessageBodySegments(message, messageIndex)"
                :key="`${message.id}-${index}`"
              >
                <a
                  v-if="segment.type === 'link'"
                  :href="segment.value"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ segment.value }}
                </a>
                <span
                  v-else-if="segment.type === 'mention'"
                  class="mention-token"
                  :title="segment.username || ''"
                  :style="segment.color ? {color: segment.color} : undefined"
                >
                  {{ segment.value }}
                </span>
                <span
                  v-else-if="segment.type === 'timeTag'"
                  class="time-reference"
                  @click="onBodyTimeTagClick(segment)"
                  @mouseenter="onTimeTagMouseEnter($event, segment)"
                  @mousemove="onTimeTagMouseMove"
                  @mouseleave="onTimeTagMouseLeave"
                >
                  {{ segment.value }}
                </span>
                <span v-else>{{ segment.value }}</span>
              </template>
            </div>
            <div v-if="editingMessageId !== message.id && getMessagePreviews(message).length" class="message-previews">
              <template v-for="preview in getMessagePreviews(message)" :key="preview.key">
                <div class="preview-item">
                  <img
                    v-if="preview.type === 'image'"
                    class="preview-media preview-image"
                    :src="preview.src"
                    alt="image preview"
                    loading="lazy"
                    decoding="async"
                  />
                  <video
                    v-else-if="preview.type === 'video'"
                    class="preview-media preview-video"
                    :src="preview.src"
                    controls
                    preload="metadata"
                    playsinline
                  />
                  <iframe
                    v-else-if="preview.type === 'youtube'"
                    class="preview-media preview-embed preview-youtube-embed"
                    :src="preview.src"
                    loading="lazy"
                    allowfullscreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  />
                  <iframe
                    v-else
                    class="preview-media preview-embed"
                    :src="preview.src"
                    loading="lazy"
                    allowfullscreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  />
                </div>
              </template>
            </div>
            <div v-if="editingMessageId !== message.id" class="reaction-controls" @click.stop>
              <button class="reaction-add-btn" @click="toggleReactionPicker(message)">+</button>
              <div v-if="reactionPickerMessageId === message.id" class="reaction-picker">
                <button
                  v-for="emoji in reactionPalette()"
                  :key="`${message.id}-${emoji}`"
                  class="reaction-picker-item"
                  @click="onReactionSelect(message, emoji)"
                >
                  {{ emoji }}
                </button>
              </div>
              <button
                v-for="reaction in message.reactions"
                :key="`${message.id}-${reaction.emoji}`"
                class="reaction-chip"
                :class="{'reaction-chip-own': isMyReaction(reaction)}"
                @click="onReactionChipClick(message, reaction)"
                @mouseenter="onReactionMouseEnter($event, reaction)"
                @mousemove="onReactionMouseMove"
                @mouseleave="onReactionMouseLeave"
              >
                <span class="reaction-emoji">{{ reaction.emoji }}</span>
                <span class="reaction-count">{{ reaction.users.length }}</span>
              </button>
            </div>
          </div>
          <div v-if="error" class="error">{{ error }}</div>
        </div>
        <button
          v-if="showScrollDown"
          class="scroll-down-btn"
          @click="onScrollDownClick"
        >
          ↓
        </button>
        <div
          v-if="timeTooltipVisible"
          class="time-tooltip"
          :style="getTimeTooltipStyle()"
        >
          {{ timeTooltipText }}
        </div>
        <div
          v-if="reactionTooltipVisible"
          class="reaction-tooltip"
          :style="getReactionTooltipStyle()"
        >
          {{ reactionTooltipText }}
        </div>

        <div class="chat-input">
          <textarea
            v-model="messageText"
            ref="messageInputEl"
            class="input"
            rows="2"
            placeholder="Сообщение..."
            @keydown="onKeydown"
            @paste="onInputPaste"
          />
          <button class="btn" @click="onSend">Отправить</button>
        </div>
        <div v-if="pasteUploading" class="upload-hint">Загружаю картинку...</div>
      </main>

      <aside class="drawer drawer-right" :class="{open: rightMenuOpen}">
        <div class="drawer-head">
          <div class="drawer-title">Опции</div>
        </div>

        <div class="section-title">Профиль</div>
        <div class="field-label">Username</div>
        <div class="readonly">{{ formatUsername(me?.nickname || '') }}</div>

        <div class="field-label">Имя</div>
        <input
          v-model="profileName"
          class="users-search"
          type="text"
          placeholder="Имя в чате"
        />

        <div class="field-label">Цвет никнейма</div>
        <div class="color-row">
          <input
            v-model="profileColorPicker"
            class="color-picker"
            type="color"
            @input="onColorPicked"
          />
          <button class="ghost-btn" @click="clearNicknameColor">Сбросить</button>
        </div>
        <div class="color-value">
          {{ profileNicknameColor || 'без цвета' }}
        </div>

        <div class="section-title">Новый пароль</div>
        <input
          v-model="newPassword"
          class="users-search"
          type="password"
          placeholder="Новый пароль"
        />
        <div class="hint">Если поле пустое, пароль не меняется.</div>

        <div v-if="profileError" class="error">{{ profileError }}</div>
        <button class="logout" :disabled="profileSaving" @click="onDone">
          {{ profileSaving ? 'Сохранение...' : 'Готово' }}
        </button>
      </aside>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
<style src="./style-global.less" lang="less"/>
