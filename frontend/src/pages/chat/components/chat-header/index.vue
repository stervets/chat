<template>
  <header class="chat-header">
    <button class="icon-btn menu-toggle-btn" @click="$emit('menu')">
      <Menu :size="18"/>
    </button>

    <button
        v-if="activeDialog"
        class="header-avatar-btn"
        @click="$emit('open-active-dialog-info-page')"
    >
      <img
          v-if="getAvatarUrl(activeDialog)"
          class="header-avatar"
          :src="getAvatarUrl(activeDialog)"
          :alt="activeDialog?.title || 'Чат'"
      />
      <div v-else class="header-avatar header-avatar-fallback">
        {{ getAvatarFallback(activeDialog) }}
      </div>
    </button>

    <div class="header-text">
      <button class="title title-button" @click="$emit('open-active-dialog-info-page')">
        <span
            v-if="activeDialog?.kind === 'direct'"
            class="direct-presence-dot"
            :class="{online: !!activeDialog?.targetUser?.isOnline}"
            :title="activeDialog?.targetUser?.isOnline ? 'online' : 'offline'"
        />
        <span
            v-if="activeDialog?.kind === 'direct' && isSystemNickname(activeDialog?.targetUser?.nickname)"
            class="system-star"
        >★</span>
        {{ dialogTitle }}
      </button>

      <div v-if="hasSubtitleRow" class="subtitle-row">
        <button
            v-if="canBackToDiscussionSource"
            class="subtitle subtitle-discussion-link"
            @click="$emit('back-to-discussion-source')"
        >
          к посту
        </button>
        <div v-if="isDiscussionRoom" class="subtitle subtitle-discussion">комменты</div>
        <div v-if="isDiscussionRoom && activeDiscussionSourceDeleted" class="subtitle subtitle-discussion-deleted">
          пост удалён
        </div>
        <div v-if="wsOffline" class="ws-status" :class="`ws-status-${wsConnectionState}`">
          {{ wsStatusText }}
        </div>
      </div>
    </div>


    <button
        v-if="canStartCall"
        class="icon-btn call-btn"
        :disabled="callButtonDisabled"
        title="Позвонить"
        @click="$emit('start-call')"
    >
      <Phone :size="18"/>
    </button>

    <button
        v-if="canPinActiveDialog && activeDialog?.kind!=='direct'"
        class="icon-btn"
        :disabled="navPinPending"
        title="Закрепить комнату"
        @click="$emit('pin-active-dialog')"
    >
      <Pin :size="18"/>
    </button>

    <button
        v-if="canDeleteActiveRoom && activeDialog?.kind === 'direct'"
        class="icon-btn delete-direct-btn"
        :disabled="roomDeletePending"
        title="Очистить переписку"
        @click="$emit('delete-active-room')"
    >
      <Trash2 :size="18"/>
    </button>

    <button
        v-if="isActiveDialogAdmin && activeDialog?.kind !== 'direct'"
        class="icon-btn"
        :title="roomInviteOpen ? 'Скрыть приглашение' : 'Пригласить в комнату'"
        @click="$emit('toggle-room-invite-panel')"
    >
      <UserPlus :size="18"/>
    </button>

    <!--button class="icon-btn vpn-btn" title="VPN и прокси" @click="$emit('open-vpn-page')">
      <ShieldCheck :size="18" />
    </button-->

    <button ref="notificationButtonEl" class="icon-btn notify-btn" @click.stop="$emit('toggle-notifications-menu')">
      <Bell :size="18"/>
      <span v-if="unreadNotificationsCount" class="notify-badge">
        {{ unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount }}
      </span>
    </button>

    <button class="icon-btn icon-cog" @click="$emit('open-own-profile-page')">
      <Settings :size="18"/>
    </button>

    <div
        v-if="notificationsMenuOpen"
        ref="notificationMenuEl"
        class="notifications-menu"
        @click.stop
    >
      <div class="notifications-head-row">
        <div class="notifications-head">Уведомления</div>
        <button class="notifications-clear-btn" :disabled="!notifications.length" @click="$emit('clear-notifications')">
          Очистить
        </button>
      </div>
      <div v-if="!notifications.length" class="hint">Пока пусто</div>
      <button
          v-for="notification in notifications"
          :key="notification.id"
          class="notification-item"
          :class="{'notification-item-unread': notification.unread}"
          @click="$emit('open-notification', notification)"
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
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
