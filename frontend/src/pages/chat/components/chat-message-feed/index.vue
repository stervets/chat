<template>
          <div class="chat-body" :ref="el => setPageRef('messagesEl', el)" @scroll="onMessagesScroll">
            <div class="chat-feed">
              <div v-if="dialogSwitching || historyLoading" class="hint">Загрузка...</div>
              <div v-if="!dialogSwitching && historyLoadingMore && messages.length" class="hint">Загружаю ещё...</div>
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
                @edit-selection-capture="onEditSelectionCapture"
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
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
