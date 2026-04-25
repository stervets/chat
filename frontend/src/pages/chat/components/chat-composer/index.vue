<template>
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
                  <input v-model="localSendAnonymous" type="checkbox" />
                  <span>Отправить анонимно</span>
                </label>
              </div>
            </div>
          </div>

          <textarea
            v-model="localMessageText"
            :ref="el => setPageRef('messageInputEl', el)"
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
            :ref="el => setPageRef('galleryInputEl', el)"
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
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
