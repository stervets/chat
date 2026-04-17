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
          <div class="chat-feed">
            <div v-if="historyLoading" class="hint">Загрузка...</div>
            <div v-else-if="!messages.length" class="hint">Нет сообщений</div>
            <ChatMessageItem
              v-for="(message, messageIndex) in messages"
              :key="message.id"
              :message="message"
              :message-index="messageIndex"
              :me-id="me?.id || null"
              :is-mentioned-for-me="isMentionedForMe(message)"
              :is-blink-target="blinkMessageId === message.id"
              :is-editing="editingMessageId === message.id"
              :editing-message-text="editingMessageText"
              :message-action-pending-id="messageActionPendingId"
              :can-open-direct="canOpenDirectFromMessage(message)"
              :author-style="getAuthorStyle(message)"
              :formatted-username="formatUsername(message.authorNickname)"
              :formatted-time="formatMessageTime(message.createdAt)"
              :rendered-html="getRenderedMessageHtml(message, messageIndex)"
              :extra-previews="getMessageExtraPreviews(message)"
              :reaction-picker-open="reactionPickerMessageId === message.id"
              :reaction-palette="reactionPalette()"
              @update:editing-message-text="onEditingMessageTextUpdate"
              @author-click="onAuthorClick"
              @direct-jump-click="onDirectFromMessageClick"
              @time-click="onMessageTimeClick"
              @start-edit="startMessageEdit"
              @delete-message="deleteOwnMessage"
              @edit-input-keydown="onEditMessageKeydown"
              @save-edit="saveMessageEdit"
              @cancel-edit="cancelMessageEdit"
              @message-body-click="onMessageBodyClick"
              @message-body-mousemove="onMessageBodyMouseMove"
              @message-body-mouseleave="onMessageBodyMouseLeave"
              @toggle-reaction-picker="toggleReactionPicker"
              @reaction-select="onReactionSelect"
              @reaction-chip-click="onReactionChipClick"
              @reaction-mouseenter="onReactionMouseEnter"
              @reaction-mousemove="onReactionMouseMove"
              @reaction-mouseleave="onReactionMouseLeave"
            />
            <div v-if="error" class="error">{{ error }}</div>
          </div>
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
          <div class="composer-tools" @click.stop>
            <button
              class="composer-tools-toggle"
              :class="{open: composerToolsOpen}"
              title="Форматирование и эмодзи"
              aria-label="Форматирование и эмодзи"
              @click="toggleComposerTools"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9"/>
                <circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none"/>
                <circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none"/>
                <path d="M8 14.2c.9 1.3 2.3 2 4 2s3.1-.7 4-2"/>
              </svg>
            </button>
            <div v-if="composerToolsOpen" class="composer-tools-panel">
              <div class="composer-section">
                <div class="composer-section-title">Формат</div>
                <div class="composer-format-buttons">
                  <button class="composer-format-btn composer-format-btn-bold" @click="applyFormatWrapper('b')">B</button>
                  <button class="composer-format-btn composer-format-btn-underline" @click="applyFormatWrapper('u')">U</button>
                  <button class="composer-format-btn composer-format-btn-strike" @click="applyFormatWrapper('s')">S</button>
                  <button class="composer-format-btn" @click="applyFormatWrapper('h')">Скрыть</button>
                  <button class="composer-format-btn composer-format-btn-mono" @click="applyFormatWrapper('m')">Mono</button>
                </div>
                <div class="composer-color-grid">
                  <button
                    v-for="named in composerNamedColors()"
                    :key="`format-color-${named.name}`"
                    class="composer-color-btn"
                    :title="`c#${named.name}(... )`"
                    @click="applyNamedColorWrapper(named.name)"
                  >
                    <span class="composer-color-dot" :style="{background: named.swatch}"/>
                    <span class="composer-color-label">{{ named.name }}</span>
                  </button>
                </div>
                <div class="composer-custom-color">
                  <input
                    v-model="composerColorPicker"
                    class="composer-color-picker"
                    type="color"
                  />
                  <button class="composer-format-btn composer-format-btn-color" @click="applyCustomColorWrapper">
                    c{{ composerColorPicker.toUpperCase() }}
                  </button>
                </div>
                <div class="composer-upload-row">
                  <button class="composer-format-btn composer-format-btn-upload" @click="openGalleryPicker">
                    Из галереи
                  </button>
                </div>
              </div>

              <div class="composer-section">
                <div class="composer-section-title">Эмодзи</div>
                <div class="composer-emoji-grid">
                  <button
                    v-for="emoji in composerEmojis()"
                    :key="`composer-emoji-${emoji}`"
                    class="composer-emoji-btn"
                    @click="onComposerEmojiClick(emoji)"
                  >
                    {{ emoji }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <textarea
            v-model="messageText"
            ref="messageInputEl"
            class="input"
            rows="2"
            placeholder="Сообщение..."
            @focus="captureInputSelection"
            @click="captureInputSelection"
            @select="captureInputSelection"
            @keyup="captureInputSelection"
            @keydown="onKeydown"
            @paste="onInputPaste"
          />
          <input
            ref="galleryInputEl"
            class="gallery-input"
            type="file"
            accept="image/*"
            multiple
            @change="onGalleryInputChange"
          />
          <button class="btn send-btn" aria-label="Отправить сообщение" title="Отправить сообщение" @click="onSend">
            <svg viewBox="0 0 24 24" class="send-icon" aria-hidden="true">
              <path d="M3.5 11.8 19.8 4.5c.8-.4 1.6.4 1.2 1.2l-7.3 16.3c-.4.9-1.7.8-2-.1L9.9 15 3.6 13.2c-.9-.3-1-.9-.1-1.4Z"/>
            </svg>
          </button>
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
