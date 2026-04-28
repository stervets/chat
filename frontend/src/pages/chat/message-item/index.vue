<template>
  <div
    ref="rootEl"
    class="message chat-message-item"
    :class="{
      'message-own': isOwnMessage(),
      'message-mention-me': isMentionedForMe,
      'message-blink-target': isBlinkTarget,
      'message-fresh': isFreshMessage,
    }"
    :data-message-id="message.id"
  >
    <div class="message-layout">
      <button
        class="message-avatar-btn"
        type="button"
        :title="`Открыть профиль @${message.authorNickname}`"
        @click="onAuthorAvatarClick"
      >
        <img
          v-if="message.authorAvatarUrl"
          class="message-avatar"
          :src="message.authorAvatarUrl"
          :alt="message.authorName"
        />
        <div v-else class="message-avatar message-avatar-fallback">
          {{ authorAvatarFallback() }}
        </div>
      </button>

      <div class="message-content">
        <div class="message-meta">
          <span v-if="isSystemAuthor" class="author-system-star">★</span>
          <span
            v-if="showAuthorBadge"
            class="author-badge"
            :style="{opacity: authorBadgeOpacity}"
          >
            ⭐
          </span>
          <span
            class="author message-meta-action"
            :style="authorStyle"
            @click="onAuthorClick"
          >
            {{ message.authorName }}
          </span>
          <span class="nickname message-meta-action" @click="onAuthorClick">
            {{ formattedUsername }}
          </span>
          <span
            v-if="canOpenDirect"
            class="direct-jump message-meta-action"
            title="Открыть директ"
            @click="onDirectJumpClick"
          >
            ↗
          </span>
          <span class="time message-meta-action" @click="onTimeClick">
            {{ formattedTime }}
          </span>
        </div>

        <div v-if="isEditing" class="message-edit">
          <textarea
            :ref="setEditInputRef"
            :value="editingMessageText"
            class="message-edit-input"
            rows="3"
            @input="onEditingInput"
            @focus="onEditSelectionCapture"
            @click="onEditSelectionCapture"
            @select="onEditSelectionCapture"
            @keyup="onEditSelectionCapture"
            @keydown="onEditInputKeydown"
          />
          <div class="message-edit-actions">
            <button class="ghost-btn message-edit-cancel" @click="onCancelEdit">Отмена</button>
            <button
              class="btn message-edit-save"
              :disabled="messageActionPendingId === message.id"
              @click="onSaveEdit"
            >
              Сохранить
            </button>
          </div>
        </div>

        <div
          v-else
          class="message-body"
          :class="{'message-body-show-hidden': showHiddenText}"
          @click="onBodyClick"
          @mousemove="onBodyMouseMove"
          @mouseleave="onBodyMouseLeave"
        >
          <div class="message-rendered-html" v-html="renderedHtml"/>
        </div>

        <div v-if="!isEditing && extraPreviews.length" class="message-previews">
          <template v-for="preview in extraPreviews" :key="preview.key">
            <div class="preview-item">
              <img
                v-if="preview.type === 'image'"
                class="preview-media preview-image"
                :src="preview.src"
                alt="image preview"
                loading="lazy"
                decoding="async"
                @click="onImagePreviewClick(preview)"
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

        <div v-if="!isEditing" class="message-footer">
          <div ref="reactionControlsEl" class="reaction-controls" @click.stop>
            <button class="reaction-add-btn" @click="onToggleReactionPicker">+</button>
            <div
              v-if="reactionPickerOpen"
              ref="reactionPickerEl"
              class="reaction-picker"
              :class="{
                'reaction-picker-up': reactionPickerDirection === 'up',
                'reaction-picker-down': reactionPickerDirection === 'down',
              }"
              :style="{maxHeight: `${reactionPickerMaxHeight}px`}"
            >
              <button
                v-for="emoji in reactionPalette"
                :key="`${message.id}-${emoji}`"
                class="reaction-picker-item"
                @click="onReactionSelect(emoji)"
              >
                {{ emoji }}
              </button>
            </div>
            <button
              v-for="reaction in message.reactions"
              :key="`${message.id}-${reaction.emoji}`"
              class="reaction-chip"
              :class="{
                'reaction-chip-own': isMyReaction(reaction),
                'reaction-chip-pop': isReactionPopping(reaction),
              }"
              @click="onReactionChipClick(reaction)"
              @mouseenter="onReactionMouseEnter($event, reaction)"
              @mousemove="onReactionMouseMove"
              @mouseleave="onReactionMouseLeave"
            >
              <span class="reaction-emoji">{{ reaction.emoji }}</span>
              <span class="reaction-count">{{ reaction.users.length }}</span>
            </button>
          </div>

          <div class="message-action-bar" @click.stop>
            <button
              v-if="canPinMessage"
              class="message-icon-btn"
              :class="{'message-icon-btn-active': isPinnedMessage}"
              :title="isPinnedMessage ? 'Открепить' : 'Закрепить'"
              @click="onTogglePinnedMessage"
            >
              <PinOff v-if="isPinnedMessage" :size="14" />
              <Pin v-else :size="14" />
            </button>
            <button
              v-if="isOwnMessage() && message.kind === 'text'"
              class="message-icon-btn"
              title="Редактировать"
              :disabled="messageActionPendingId === message.id"
              @click="onStartEdit"
            >
              <Pencil :size="14" />
            </button>
            <button
              v-if="isOwnMessage()"
              class="message-icon-btn message-icon-btn-danger"
              title="Удалить"
              :disabled="messageActionPendingId === message.id"
              @click="onDeleteMessage"
            >
              <Trash2 :size="14" />
            </button>
            <button
              v-if="canOpenDiscussion"
              class="message-comment-btn"
              :class="{
                'message-comment-btn-active': Math.max(0, Number(message.commentCount || 0)) > 0,
              }"
              :disabled="discussionOpenPendingId === message.id"
              :title="message.commentRoomId ? 'Открыть комментарии' : 'Создать комментарии'"
              @click="onOpenDiscussion"
            >
              <MessageCircleMore :size="14" />
              <span>{{ Math.max(0, Number(message.commentCount || 0)) }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
