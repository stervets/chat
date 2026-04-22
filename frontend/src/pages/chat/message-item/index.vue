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
    <div class="message-meta">
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
      <button
        v-if="canPinMessage && !isEditing"
        class="message-inline-btn"
        :class="{'message-inline-btn-active': isPinnedMessage}"
        @click="onTogglePinnedMessage"
      >
        {{ isPinnedMessage ? 'откреп.' : 'закреп.' }}
      </button>
      <button
        v-if="isOwnMessage() && !isEditing && message.kind === 'text'"
        class="message-inline-btn"
        :disabled="messageActionPendingId === message.id"
        @click="onStartEdit"
      >
        ред.
      </button>
      <button
        v-if="isOwnMessage() && !isEditing"
        class="message-inline-btn message-inline-btn-danger"
        :disabled="messageActionPendingId === message.id"
        @click="onDeleteMessage"
      >
        удал.
      </button>
    </div>

    <div v-if="isEditing" class="message-edit">
      <textarea
        :value="editingMessageText"
        class="message-edit-input"
        rows="3"
        @input="onEditingInput"
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
      <div v-if="message.kind !== 'scriptable'" class="message-rendered-html" v-html="renderedHtml"/>
      <ScriptableMessage
        v-else
        :message="message"
        :view-model="scriptViewModel"
        @action="onScriptAction"
      />
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

    <div v-if="!isEditing" ref="reactionControlsEl" class="reaction-controls" @click.stop>
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
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
