<template>
  <div class="page page-chat">
    <div class="chat-shell">
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
            <button class="left-nav-tab" :class="{active: leftNavMode === 'directs'}" @click="leftNavMode = 'directs'">
              Директы
            </button>
            <button class="left-nav-tab" :class="{active: leftNavMode === 'rooms'}" @click="leftNavMode = 'rooms'">
              Комнаты
            </button>
          </div>

          <div v-if="leftNavMode === 'directs'" class="drawer-fixed drawer-fixed-top">
            <input
              v-model="searchQuery"
              class="users-search"
              type="text"
              placeholder="Найти директ или пользователя..."
            />
          </div>

          <div v-else class="drawer-fixed drawer-fixed-top">
            <input
              v-model="roomSearchQuery"
              class="users-search"
              type="text"
              placeholder="Найти комнату..."
            />
          </div>

          <div class="left-nav-scroll">
            <template v-if="leftNavMode === 'directs'">
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

              <div v-if="searchQuery.trim()" class="section-title">Пользователи</div>
              <div v-if="searchQuery.trim() && !filteredUsers.length" class="hint">Ничего не найдено</div>
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
                    <span class="nickname">
                      {{ dialog.visibility === 'private' ? 'private' : 'public' }}
                      · {{ dialog.postOnlyByAdmin ? 'пишет админ' : 'пишут все' }}
                    </span>
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
                    <span class="nickname">{{ dialog.postOnlyByAdmin ? 'канал' : 'public' }}</span>
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

      <div v-if="isCompactLayout && leftMenuOpen" class="drawer-backdrop" @click="closeLeftMenu"/>

      <main
        class="chat-main"
        :class="{
          'chat-main-general': activeDialog?.kind !== 'direct',
          'chat-main-private': activeDialog?.kind === 'direct',
        }"
      >
        <header class="chat-header">
          <button class="icon-btn menu-toggle-btn" @click="toggleLeftMenu">
            <Menu :size="18" />
          </button>
          <button
            v-if="activeDialog"
            class="header-avatar-btn"
            @click="onOpenActiveDialogInfoPage"
          >
            <img
              v-if="resolveDialogAvatarUrl(activeDialog)"
              class="header-avatar"
              :src="resolveDialogAvatarUrl(activeDialog)"
              :alt="activeDialog?.title || 'Чат'"
            />
            <div v-else class="header-avatar header-avatar-fallback">
              {{ getDialogAvatarFallback(activeDialog) }}
            </div>
          </button>
          <div class="header-text">
            <button class="title title-button" @click="onOpenActiveDialogInfoPage">
              <span
                v-if="activeDialog?.kind === 'direct' && isSystemNickname(activeDialog?.targetUser?.nickname)"
                class="system-star"
              >★</span>
              {{ activeDialog?.kind === 'direct' ? (activeDialog?.title || 'Чат') : (activeDialog?.title || 'Общий чат') }}
            </button>
            <div class="subtitle-row">
              <div class="subtitle" v-if="activeDialog?.kind === 'direct'">директ</div>
              <div v-else-if="activeDialog?.visibility" class="subtitle">
                {{ activeDialog.visibility === 'private' ? 'private' : 'public' }}
              </div>
              <div v-if="activeDialog?.postOnlyByAdmin" class="subtitle">пишет только админ</div>
              <div v-if="isDiscussionRoom" class="subtitle subtitle-discussion">комментарии</div>
              <button
                v-if="canBackToDiscussionSource"
                class="subtitle subtitle-discussion-link"
                @click="onBackToDiscussionSource"
              >
                к посту
              </button>
              <div v-if="isDiscussionRoom && activeDiscussionSourceDeleted" class="subtitle subtitle-discussion-deleted">
                исходный пост удалён
              </div>
              <div v-if="wsOffline" class="ws-status" :class="`ws-status-${wsConnectionState}`">
                {{ wsStatusText }}
              </div>
            </div>
          </div>
          <button
            v-if="canPinActiveDialog"
            class="icon-btn"
            :disabled="navPinPending"
            :title="activeDialog?.kind === 'direct' ? 'Закрепить директ' : 'Закрепить комнату'"
            @click="onPinActiveDialog"
          >
            <Pin :size="18" />
          </button>
          <button
            v-if="canDeleteActiveRoom"
            class="icon-btn delete-direct-btn"
            :disabled="roomDeletePending"
            :title="activeDialog?.kind === 'direct' ? 'Очистить переписку' : 'Удалить комнату'"
            @click="onDeleteActiveRoom"
          >
            <Trash2 :size="18" />
          </button>
          <button
            v-if="isActiveDialogAdmin && activeDialog?.kind !== 'direct'"
            class="icon-btn"
            :title="roomInviteOpen ? 'Скрыть приглашение' : 'Пригласить в комнату'"
            @click="toggleRoomInvitePanel"
          >
            <UserPlus :size="18" />
          </button>
          <button class="icon-btn vpn-btn" title="VPN и прокси" @click="onOpenVpnPage">
            <ShieldCheck :size="18" />
          </button>
          <button ref="notificationButtonEl" class="icon-btn notify-btn" @click.stop="toggleNotificationsMenu">
            <Bell :size="18" />
            <span v-if="unreadNotificationsCount" class="notify-badge">
              {{ unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount }}
            </span>
          </button>
          <button class="icon-btn icon-cog" @click="onOpenOwnProfilePage">
            <Settings :size="18" />
          </button>
          <div
            v-if="notificationsMenuOpen"
            ref="notificationMenuEl"
            class="notifications-menu"
            @click.stop
          >
            <div class="notifications-head-row">
              <div class="notifications-head">Уведомления</div>
              <button class="notifications-clear-btn" :disabled="!notifications.length" @click="clearNotifications">
                Очистить
              </button>
            </div>
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
                <span
                  v-if="hasNotificationAuthorDonationBadge(notification)"
                  class="donation-star"
                  :style="getNotificationAuthorDonationBadgeStyle(notification)"
                >⭐</span>
                {{ notification.authorName }}
              </div>
              <div class="notification-body">{{ getNotificationBodyPreview(notification) }}</div>
            </button>
          </div>
        </header>

        <div v-if="toasts.length" class="toast-stack">
          <div
            v-for="toast in toasts"
            :key="toast.id"
            class="toast-item"
            :class="{'toast-item-clickable': isToastClickable(toast)}"
            @click="onToastClick(toast)"
          >
            <div class="toast-head">
              <span class="toast-title">{{ toast.title }}</span>
              <button class="toast-close" @click.stop="removeToast(toast.id)">×</button>
            </div>
            <div class="toast-body">{{ toast.body }}</div>
          </div>
        </div>

        <div ref="chatContentEl" class="chat-content">
          <div v-if="roomInviteOpen && isActiveDialogAdmin && activeDialog?.kind !== 'direct'" class="room-invite-panel">
            <div class="room-invite-head">
              <div class="room-invite-title">Пригласить в комнату</div>
              <button class="ghost-btn" @click="toggleRoomInvitePanel">Закрыть</button>
            </div>
            <input
              v-model="roomInviteSearchQuery"
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

              <div v-if="roomInviteSearchQuery.trim() && filteredRoomInviteUsers.length" class="room-invite-section">
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
                v-if="!filteredRoomInviteContacts.length && (!roomInviteSearchQuery.trim() || !filteredRoomInviteUsers.length)"
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

          <div
            v-if="shouldShowPinnedPanel"
            class="pinned-panel"
            :class="{
              'pinned-panel-collapsed': pinnedCollapsed,
            }"
            :style="pinnedPanelStyle"
          >
            <div class="pinned-head">
              <span class="pinned-author" :style="getAuthorStyle(activePinnedMessage)">
                {{ activePinnedMessage.authorName }}
              </span>
              <div class="pinned-actions">
                <button
                  class="pinned-collapse-btn"
                  :title="pinnedCollapsed ? 'Развернуть закреп' : 'Свернуть закреп'"
                  @click="togglePinnedCollapsed"
                >
                  {{ pinnedCollapsed ? '▸' : '▾' }}
                </button>
                <button
                  v-if="canManagePinnedMessages"
                  class="pinned-unpin-btn"
                  title="Удалить закреп"
                  @click="unpinActiveMessage"
                >
                  откреп.
                </button>
              </div>
            </div>
            <div
              v-if="!pinnedCollapsed"
              class="pinned-body"
              @click="onPinnedBodyClick"
              v-html="getRenderedMessageHtml(activePinnedMessage, -1)"
            />
          </div>
          <ElDivider
            v-if="shouldShowPinnedPanel && !pinnedCollapsed"
            class="pinned-splitter"
            @pointerdown.prevent="onPinnedSplitterPointerDown"
          />

          <div class="chat-body" ref="messagesEl" @scroll="onMessagesScroll">
            <div class="chat-feed">
              <div v-if="historyLoading" class="hint">Загрузка...</div>
              <div v-else-if="!messages.length" class="hint">Нет сообщений</div>
              <div v-if="historyLoadingMore && messages.length" class="hint">Загружаю ещё...</div>
              <div
                v-if="virtualTopSpacerHeight > 0"
                class="chat-feed-spacer"
                :style="{height: `${virtualTopSpacerHeight}px`}"
              />
              <ChatMessageItem
                v-for="item in virtualMessages"
                :key="item.message.id"
                :message="item.message"
                :message-index="item.sourceIndex"
                :me-id="me?.id || null"
                :is-mentioned-for-me="isMentionedForMe(item.message)"
                :is-blink-target="blinkMessageId === item.message.id"
                :is-editing="editingMessageId === item.message.id"
                :editing-message-text="editingMessageText"
                :message-action-pending-id="messageActionPendingId"
                :can-pin-message="canManagePinnedMessages"
                :can-open-discussion="canOpenDiscussionFromMessage(item.message)"
                :discussion-open-pending-id="discussionOpenPendingMessageId"
                :is-pinned-message="activePinnedMessage?.id === item.message.id"
                :can-open-direct="canOpenDirectFromMessage(item.message)"
                :author-style="getAuthorStyle(item.message)"
                :show-author-badge="hasMessageAuthorDonationBadge(item.message)"
                :is-system-author="isSystemNickname(item.message.authorNickname)"
                :author-badge-opacity="getMessageAuthorDonationBadgeOpacity(item.message)"
                :formatted-username="formatUsername(item.message.authorNickname)"
                :formatted-time="formatMessageTime(item.message.createdAt)"
                :is-fresh-message="isFreshMessage(item.message.id)"
                :rendered-html="getRenderedMessageHtml(item.message, item.sourceIndex)"
                :extra-previews="getMessageExtraPreviews(item.message)"
                :reaction-picker-open="reactionPickerMessageId === item.message.id"
                :reaction-palette="reactionPalette()"
                @update:editing-message-text="onEditingMessageTextUpdate"
                @author-click="onAuthorClick"
                @author-avatar-click="onMessageAuthorAvatarClick"
                @direct-jump-click="onDirectFromMessageClick"
                @time-click="onMessageTimeClick"
                @start-edit="startMessageEdit"
                @delete-message="deleteOwnMessage"
                @toggle-pinned-message="onTogglePinnedMessage"
                @open-discussion="openMessageDiscussion"
                @edit-input-keydown="onEditMessageKeydown"
                @save-edit="saveMessageEdit"
                @cancel-edit="cancelMessageEdit"
                @message-body-click="onMessageBodyClick"
                @image-preview-click="onMessageImageClick"
                @message-body-mousemove="onMessageBodyMouseMove"
                @message-body-mouseleave="onMessageBodyMouseLeave"
                @toggle-reaction-picker="toggleReactionPicker"
                @reaction-select="onReactionSelect"
                @reaction-chip-click="onReactionChipClick"
                @reaction-mouseenter="onReactionMouseEnter"
                @reaction-mousemove="onReactionMouseMove"
                @reaction-mouseleave="onReactionMouseLeave"
                @height-change="onVirtualItemHeight"
              />
              <div
                v-if="virtualBottomSpacerHeight > 0"
                class="chat-feed-spacer"
                :style="{height: `${virtualBottomSpacerHeight}px`}"
              />
              <div v-if="error" class="error">{{ error }}</div>
            </div>
          </div>
        </div>

        <button v-if="showScrollDown" class="scroll-down-btn" @click="onScrollDownClick">↓</button>
        <div v-if="timeTooltipVisible" class="time-tooltip" :style="getTimeTooltipStyle()">
          {{ timeTooltipText }}
        </div>
        <div v-if="reactionTooltipVisible" class="reaction-tooltip" :style="getReactionTooltipStyle()">
          {{ reactionTooltipText }}
        </div>

        <div v-if="canComposeInActiveDialog" class="chat-input">
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
                  <button class="composer-format-btn" @click="applyFormatWrapper('h')">Hidden</button>
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
                <div class="composer-upload-row">
                  <button class="composer-format-btn composer-format-btn-upload" @click="openGalleryPicker">
                    Загрузить фото/видео
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

              <div class="composer-section">
                <label class="composer-checkbox-row">
                  <input v-model="sendAnonymous" type="checkbox" />
                  <span>Отправить анонимно</span>
                </label>
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
            accept="image/*,video/*"
            multiple
            @change="onGalleryInputChange"
          />
          <button class="btn send-btn" aria-label="Отправить сообщение" title="Отправить сообщение" @click="onSend">
            <svg viewBox="0 0 24 24" class="send-icon" aria-hidden="true">
              <path d="M3.5 11.8 19.8 4.5c.8-.4 1.6.4 1.2 1.2l-7.3 16.3c-.4.9-1.7.8-2-.1L9.9 15 3.6 13.2c-.9-.3-1-.9-.1-1.4Z"/>
            </svg>
          </button>
        </div>
        <div v-if="canComposeInActiveDialog && pasteUploading" class="upload-hint">Загружаю файл...</div>
      </main>

      <div v-if="imageViewerVisible" class="image-viewer" @click="onImageViewerBackdropClick">
        <button class="image-viewer-close" aria-label="Закрыть" @click="closeImageViewer">×</button>
        <img
          class="image-viewer-media"
          :src="imageViewerSrc"
          :alt="imageViewerAlt || 'image preview'"
          @click.stop
        />
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
<style src="./style-global.less" lang="less"/>
