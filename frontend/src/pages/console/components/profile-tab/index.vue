<template>
        <div class="console-card">
          <div v-if="profile" class="profile-top">
            <div class="profile-avatar-wrap">
              <button
                v-if="profileDisplayAvatarUrl"
                class="media-viewer-trigger"
                type="button"
                @click="openMediaViewer(profileDisplayAvatarUrl, profileDisplayName || profile.nickname)"
              >
                <img
                  class="profile-avatar"
                  :src="profileDisplayAvatarUrl"
                  :alt="profileDisplayName || profile.nickname"
                />
              </button>
              <div v-else class="profile-avatar profile-avatar-fallback">
                {{ userAvatarFallback(profile) }}
              </div>
              <label v-if="isOwnProfile" class="avatar-upload-btn">
                <input class="avatar-input" type="file" accept="image/*" @change="onProfileAvatarInputChange" />
                <ImagePlus :size="16" />
                <span>Сменить аватар</span>
              </label>
            </div>

            <div class="profile-head">
              <div class="profile-name-row">
                <span
                  class="profile-presence-dot"
                  :class="{online: !!profile.isOnline || isOwnProfile}"
                  :title="(!!profile.isOnline || isOwnProfile) ? 'online' : 'offline'"
                />
                <span v-if="isSystemNickname(profile.nickname)" class="system-star">★</span>
                <div class="profile-name" :style="{color: profileDisplayNicknameColor || undefined}">
                  {{ profileDisplayName }}
                </div>
                <span v-if="hasDonationBadge" class="profile-badge">⭐ донат</span>
              </div>
              <div class="profile-nickname">@{{ profile.nickname }}</div>
              <div v-if="profile.info" class="profile-info">{{ profile.info }}</div>

              <div v-if="!isOwnProfile" class="action-row">
                <button class="btn" @click="onWriteToUser">
                  <MessageCircleMore :size="16" />
                  <span>Написать</span>
                </button>
                <button class="ghost-btn" :disabled="contactBusy || isSystemNickname(profile.nickname)" @click="toggleContact">
                  <UserRoundPlus v-if="!isContact" :size="16" />
                  <UserRoundMinus v-else :size="16" />
                  <span>{{ isSystemNickname(profile.nickname) ? 'Системный контакт' : (isContact ? 'Убрать из контактов' : 'Добавить в контакты') }}</span>
                </button>
              </div>
            </div>
          </div>

          <template v-if="profile && isOwnProfile">
            <div class="section-title">Профиль</div>
            <label class="field-label">Имя</label>
            <input v-model="localProfileName" class="field-input" type="text" placeholder="Имя" />

            <label class="field-label">О себе</label>
            <textarea v-model="localProfileInfo" class="field-textarea" rows="5" placeholder="О себе" />

            <label class="field-label">Цвет никнейма</label>
            <div class="color-row">
              <input v-model="localProfileColorPicker" class="color-picker" type="color" @input="onColorPicked" />
              <button class="ghost-btn" @click="clearNicknameColor">Сбросить</button>
              <span class="hint">{{ profileNicknameColor || 'без цвета' }}</span>
            </div>

            <label class="toggle-row">
              <input v-model="localPushDisableAllMentions" type="checkbox" />
              <span>Не слать push от @all</span>
            </label>

            <div class="section-title">Уведомления</div>
            <label class="toggle-row">
              <input v-model="localSoundEnabled" type="checkbox" @change="onSoundEnabledChange" />
              <span>Звук уведомлений</span>
            </label>
            <label class="toggle-row">
              <input v-model="localVibrationEnabled" type="checkbox" @change="onVibrationEnabledChange" />
              <span>Вибрация</span>
            </label>
            <label class="toggle-row">
              <input v-model="localBrowserNotificationsEnabled" type="checkbox" @change="onBrowserNotificationsEnabledChange" />
              <span>Уведомления браузера</span>
            </label>
            <div class="hint">Browser permission: {{ browserNotificationPermission }}</div>
            <button
              v-if="browserNotificationsEnabled && browserNotificationPermission !== 'granted'"
              class="ghost-btn"
              @click="requestBrowserNotificationPermission"
            >
              Разрешить уведомления
            </button>

            <template v-if="isStandaloneApp">
              <div class="section-title">Web Push</div>
              <div class="hint">Статус: {{ webPushStatusText }}</div>
              <label class="toggle-row">
                <input
                  v-model="localWebPushSettingEnabled"
                  type="checkbox"
                  :disabled="webPushBusy || !webPushSupported || !webPushAvailable"
                  @change="onWebPushEnabledChange"
                />
                <span>{{ webPushBusy ? 'Push-уведомления (обновляем...)' : 'Push-уведомления' }}</span>
              </label>
              <div v-if="webPushRequiresIosInstall" class="hint">
                На iPhone Web Push работает только в установленном приложении.
              </div>
              <button
                v-if="isDevMode && webPushSupported"
                class="ghost-btn"
                :disabled="webPushTestBusy || !canSendWebPushTest"
                @click="sendWebPushTest"
              >
                {{ webPushTestBusy ? 'Отправляем тест...' : 'Тестовый push' }}
              </button>
              <div v-if="webPushTestStatus" class="hint">{{ webPushTestStatus }}</div>
              <div v-if="webPushError" class="error">{{ webPushError }}</div>
            </template>

            <div class="section-title">Пароль</div>
            <input v-model="localNewPassword" class="field-input" type="password" placeholder="Новый пароль" />
            <div class="hint">Если поле пустое, пароль не меняется.</div>

            <div v-if="saveError" class="error">{{ saveError }}</div>
            <div v-if="saveSuccess" class="success">{{ saveSuccess }}</div>
            <div class="action-row">
              <button class="btn" :disabled="saving" @click="onSaveProfile">
                <Save :size="16" />
                <span>{{ saving ? 'Сохраняю...' : 'Сохранить' }}</span>
              </button>
            </div>
          </template>
        </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
