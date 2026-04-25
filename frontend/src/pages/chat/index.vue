<template>
  <div class="page page-chat">
    <div class="chat-shell">
      <ChatLeftDrawer
        :active-dialog="activeDialog"
        :filtered-direct-dialogs="filteredDirectDialogs"
        :filtered-joined-rooms="filteredJoinedRooms"
        :filtered-public-rooms="filteredPublicRooms"
        :filtered-users="filteredUsers"
        :format-username="formatUsername"
        :get-dialog-avatar-fallback="getDialogAvatarFallback"
        :get-donation-badge-style="getDonationBadgeStyle"
        :get-user-name-style="getUserNameStyle"
        :has-donation-badge="hasDonationBadge"
        :is-compact-layout="isCompactLayout"
        :is-direct-dialog-unread="isDirectDialogUnread"
        :is-system-user="isSystemUser"
        :left-menu-open="leftMenuOpen"
        :left-nav-mode="leftNavMode"
        :me="me"
        :resolve-dialog-avatar-url="resolveDialogAvatarUrl"
        :room-search-query="roomSearchQuery"
        :search-query="searchQuery"
        @close="closeLeftMenu"
        @join-public-room="joinPublicRoom"
        @logout="onLogout"
        @select-direct-dialog="selectDirectDialog"
        @select-room-dialog="selectRoomDialog"
        @select-user="selectUser"
        @update:left-nav-mode="leftNavMode = $event"
        @update:room-search-query="roomSearchQuery = $event"
        @update:search-query="searchQuery = $event"
      />
      <div v-if="isCompactLayout && leftMenuOpen" class="drawer-backdrop" @click="closeLeftMenu"/>

      <main
        class="chat-main"
        :class="{
          'chat-main-general': activeDialog?.kind !== 'direct',
          'chat-main-private': activeDialog?.kind === 'direct',
        }"
      >
        <ChatHeader
          :active-dialog="activeDialog"
          :active-discussion-source-deleted="activeDiscussionSourceDeleted"
          :can-back-to-discussion-source="canBackToDiscussionSource"
          :can-delete-active-room="canDeleteActiveRoom"
          :can-pin-active-dialog="canPinActiveDialog"
          :format-message-time="formatMessageTime"
          :get-dialog-avatar-fallback="getDialogAvatarFallback"
          :get-notification-author-donation-badge-style="getNotificationAuthorDonationBadgeStyle"
          :get-notification-body-preview="getNotificationBodyPreview"
          :get-notification-dialog-title="getNotificationDialogTitle"
          :has-notification-author-donation-badge="hasNotificationAuthorDonationBadge"
          :is-active-dialog-admin="isActiveDialogAdmin"
          :is-discussion-room="isDiscussionRoom"
          :is-system-nickname="isSystemNickname"
          :nav-pin-pending="navPinPending"
          :notifications="notifications"
          :notifications-menu-open="notificationsMenuOpen"
          :resolve-dialog-avatar-url="resolveDialogAvatarUrl"
          :room-delete-pending="roomDeletePending"
          :room-invite-open="roomInviteOpen"
          :unread-notifications-count="unreadNotificationsCount"
          :ws-connection-state="wsConnectionState"
          :ws-offline="wsOffline"
          :ws-status-text="wsStatusText"
          @back-to-discussion-source="onBackToDiscussionSource"
          @clear-notifications="clearNotifications"
          @delete-active-room="onDeleteActiveRoom"
          @menu="toggleLeftMenu"
          @notification-button-ready="notificationButtonEl = $event"
          @notification-menu-ready="notificationMenuEl = $event"
          @open-active-dialog-info-page="onOpenActiveDialogInfoPage"
          @open-notification="openNotification"
          @open-own-profile-page="onOpenOwnProfilePage"
          @open-vpn-page="onOpenVpnPage"
          @pin-active-dialog="onPinActiveDialog"
          @toggle-notifications-menu="toggleNotificationsMenu"
          @toggle-room-invite-panel="toggleRoomInvitePanel"
        />

        <ChatToasts
          :is-toast-clickable="isToastClickable"
          :toasts="toasts"
          @close-toast="removeToast"
          @toast-click="onToastClick"
        />

        <div ref="chatContentEl" class="chat-content">
          <RoomInvitePanel
            :active-dialog="activeDialog"
            :filtered-room-invite-contacts="filteredRoomInviteContacts"
            :filtered-room-invite-users="filteredRoomInviteUsers"
            :format-username="formatUsername"
            :get-donation-badge-style="getDonationBadgeStyle"
            :get-user-name-style="getUserNameStyle"
            :has-donation-badge="hasDonationBadge"
            :is-active-dialog-admin="isActiveDialogAdmin"
            :is-room-invite-selected="isRoomInviteSelected"
            :is-system-user="isSystemUser"
            :room-invite-error="roomInviteError"
            :room-invite-loading="roomInviteLoading"
            :room-invite-open="roomInviteOpen"
            :room-invite-search-query="roomInviteSearchQuery"
            :room-invite-selected-ids="roomInviteSelectedIds"
            @close="toggleRoomInvitePanel"
            @submit="submitRoomInvite"
            @toggle-selection="toggleRoomInviteSelection"
            @update:room-invite-search-query="roomInviteSearchQuery = $event"
          />

          <PinnedPanel
            :active-pinned-message="activePinnedMessage"
            :can-manage-pinned-messages="canManagePinnedMessages"
            :get-author-style="getAuthorStyle"
            :get-rendered-message-html="getRenderedMessageHtml"
            :pinned-collapsed="pinnedCollapsed"
            :pinned-panel-style="pinnedPanelStyle"
            :should-show-pinned-panel="shouldShowPinnedPanel"
            @body-click="onPinnedBodyClick"
            @splitter-pointer-down="onPinnedSplitterPointerDown"
            @toggle-collapsed="togglePinnedCollapsed"
            @unpin="unpinActiveMessage"
          />

          <ChatMessageFeed
            :active-pinned-message="activePinnedMessage"
            :blink-message-id="blinkMessageId"
            :can-manage-pinned-messages="canManagePinnedMessages"
            :can-open-direct-from-message="canOpenDirectFromMessage"
            :can-open-discussion-from-message="canOpenDiscussionFromMessage"
            :discussion-open-pending-message-id="discussionOpenPendingMessageId"
            :editing-message-id="editingMessageId"
            :editing-message-text="editingMessageText"
            :error="error"
            :format-message-time="formatMessageTime"
            :format-username="formatUsername"
            :get-author-style="getAuthorStyle"
            :get-message-author-donation-badge-opacity="getMessageAuthorDonationBadgeOpacity"
            :get-message-extra-previews="getMessageExtraPreviews"
            :get-rendered-message-html="getRenderedMessageHtml"
            :has-message-author-donation-badge="hasMessageAuthorDonationBadge"
            :history-loading="historyLoading"
            :history-loading-more="historyLoadingMore"
            :is-fresh-message="isFreshMessage"
            :is-mentioned-for-me="isMentionedForMe"
            :is-system-nickname="isSystemNickname"
            :me="me"
            :message-action-pending-id="messageActionPendingId"
            :messages="messages"
            :reaction-palette="reactionPalette"
            :reaction-picker-message-id="reactionPickerMessageId"
            :virtual-bottom-spacer-height="virtualBottomSpacerHeight"
            :virtual-messages="virtualMessages"
            :virtual-top-spacer-height="virtualTopSpacerHeight"
            @author-avatar-click="onMessageAuthorAvatarClick"
            @author-click="onAuthorClick"
            @cancel-edit="cancelMessageEdit"
            @delete-message="deleteOwnMessage"
            @direct-jump-click="onDirectFromMessageClick"
            @edit-input-keydown="onEditMessageKeydown"
            @height-change="onVirtualItemHeight"
            @image-preview-click="onMessageImageClick"
            @message-body-click="onMessageBodyClick"
            @message-body-mouseleave="onMessageBodyMouseLeave"
            @message-body-mousemove="onMessageBodyMouseMove"
            @open-discussion="openMessageDiscussion"
            @page-ref="setPageRef"
            @reaction-chip-click="onReactionChipClick"
            @reaction-mouseenter="onReactionMouseEnter"
            @reaction-mouseleave="onReactionMouseLeave"
            @reaction-mousemove="onReactionMouseMove"
            @reaction-select="onReactionSelect"
            @save-edit="saveMessageEdit"
            @scroll="onMessagesScroll"
            @start-edit="startMessageEdit"
            @time-click="onMessageTimeClick"
            @toggle-pinned-message="onTogglePinnedMessage"
            @toggle-reaction-picker="toggleReactionPicker"
            @update:editing-message-text="editingMessageText = $event"
          />
        </div>

        <button v-if="showScrollDown" class="scroll-down-btn" @click="onScrollDownClick">↓</button>
        <div v-if="timeTooltipVisible" class="time-tooltip" :style="getTimeTooltipStyle()">
          {{ timeTooltipText }}
        </div>
        <div v-if="reactionTooltipVisible" class="reaction-tooltip" :style="getReactionTooltipStyle()">
          {{ reactionTooltipText }}
        </div>

        <ChatComposer
          :can-compose-in-active-dialog="canComposeInActiveDialog"
          :composer-emojis="composerEmojis"
          :composer-named-colors="composerNamedColors"
          :composer-tools-open="composerToolsOpen"
          :message-text="messageText"
          :paste-uploading="pasteUploading"
          :send-anonymous="sendAnonymous"
          @apply-format-wrapper="applyFormatWrapper"
          @apply-named-color-wrapper="applyNamedColorWrapper"
          @composer-emoji-click="onComposerEmojiClick"
          @gallery-change="onGalleryInputChange"
          @keydown="onKeydown"
          @open-gallery-picker="openGalleryPicker"
          @page-ref="setPageRef"
          @paste="onInputPaste"
          @selection-capture="captureInputSelection"
          @send="onSend"
          @toggle-composer-tools="toggleComposerTools"
          @update:message-text="messageText = $event"
          @update:send-anonymous="sendAnonymous = $event"
        />
      </main>

      <ChatImageViewer
        :image-viewer-alt="imageViewerAlt"
        :image-viewer-src="imageViewerSrc"
        :image-viewer-visible="imageViewerVisible"
        @backdrop-click="onImageViewerBackdropClick"
        @close="closeImageViewer"
      />
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less"/>
<style src="./style-global.less" lang="less"/>
