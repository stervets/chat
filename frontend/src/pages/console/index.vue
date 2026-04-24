<template>
  <div class="page page-console">
    <div class="console-shell">
      <div class="console-topbar">
        <button class="ghost-btn back-btn" @click="goBack">
          <ArrowLeft :size="16" />
          <span>Назад</span>
        </button>
        <div class="console-topbar-text">
          <div class="console-title">Console</div>
          <div class="console-subtitle">Профиль, комнаты, VPN, инвайты</div>
        </div>
      </div>

      <div class="console-tabs">
        <button class="console-tab" :class="{active: activeTab === 'user'}" @click="setActiveTab('user')">
          <UserRound :size="16" />
          <span>{{ consoleUserTabLabel }}</span>
        </button>
        <button class="console-tab" :class="{active: activeTab === 'rooms'}" @click="setActiveTab('rooms')">
          <MessagesSquare :size="16" />
          <span>Комнаты</span>
        </button>
        <button class="console-tab" :class="{active: activeTab === 'vpn'}" @click="setActiveTab('vpn')">
          <ShieldCheck :size="16" />
          <span>VPN</span>
        </button>
        <button class="console-tab" :class="{active: activeTab === 'invites'}" @click="setActiveTab('invites')">
          <Ticket :size="16" />
          <span>Инвайты</span>
        </button>
      </div>

      <div v-if="loading" class="console-card">
        <div class="hint">Загрузка...</div>
      </div>
      <div v-else-if="error" class="console-card">
        <div class="error">{{ error }}</div>
      </div>
      <template v-else>
        <div v-if="activeTab === 'user'" class="console-card">
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
            <input v-model="profileName" class="field-input" type="text" placeholder="Имя" />

            <label class="field-label">О себе</label>
            <textarea v-model="profileInfo" class="field-textarea" rows="5" placeholder="О себе" />

            <label class="field-label">Цвет никнейма</label>
            <div class="color-row">
              <input v-model="profileColorPicker" class="color-picker" type="color" @input="onColorPicked" />
              <button class="ghost-btn" @click="clearNicknameColor">Сбросить</button>
              <span class="hint">{{ profileNicknameColor || 'без цвета' }}</span>
            </div>

            <label class="toggle-row">
              <input v-model="pushDisableAllMentions" type="checkbox" />
              <span>Не слать push от @all</span>
            </label>

            <div class="section-title">Уведомления</div>
            <label class="toggle-row">
              <input v-model="soundEnabled" type="checkbox" @change="onSoundEnabledChange" />
              <span>Звук уведомлений</span>
            </label>
            <label class="toggle-row">
              <input v-model="vibrationEnabled" type="checkbox" @change="onVibrationEnabledChange" />
              <span>Вибрация</span>
            </label>
            <label class="toggle-row">
              <input v-model="browserNotificationsEnabled" type="checkbox" @change="onBrowserNotificationsEnabledChange" />
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
                  v-model="webPushSettingEnabled"
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
            <input v-model="newPassword" class="field-input" type="password" placeholder="Новый пароль" />
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

        <div v-else-if="activeTab === 'rooms'" class="console-card">
          <div class="rooms-layout">
            <div class="rooms-sidebar">
              <div class="section-title">{{ roomsTabOwnerLabel }}</div>
              <div v-if="roomsLoading" class="hint">Загружаю комнаты...</div>
              <div v-else-if="roomsTabList.length" class="room-list">
                <button
                  v-for="room in roomsTabList"
                  :key="`console-room-${room.id}`"
                  class="room-list-item"
                  :class="{active: Number(selectedRoom?.id || 0) === Number(room.id || 0)}"
                  @click="openRoomTab(room.id)"
                >
                  <img
                    v-if="resolveRoomAvatarUrl(room)"
                    class="room-avatar room-avatar-sm"
                    :src="resolveRoomAvatarUrl(room)"
                    :alt="room.title || 'Комната'"
                  />
                  <div v-else class="room-avatar room-avatar-fallback room-avatar-sm">
                    {{ roomAvatarFallback(room) }}
                  </div>
                  <div class="room-list-text">
                    <div class="room-list-title">{{ room.title || 'Комната' }}</div>
                    <div class="room-list-meta">
                      {{ room.visibility === 'private' ? 'private' : 'public' }}
                      · {{ room.postOnlyByAdmin ? 'пишет только админ' : 'пишут все' }}
                    </div>
                  </div>
                </button>
              </div>
              <div v-else class="hint">Комнат нет</div>

              <template v-if="isOwnProfile">
                <button class="btn create-room-btn" @click="toggleRoomCreateForm">
                  <Plus :size="16" />
                  <span>{{ roomCreateFormOpen ? 'Скрыть форму создания' : 'Создать свою комнату' }}</span>
                </button>
                <div v-if="roomCreateFormOpen" class="room-create-form">
                  <div class="section-title">Новая комната</div>
                <label class="field-label">Название</label>
                <input v-model="roomCreateTitle" class="field-input" type="text" placeholder="Комната" />
                <label class="field-label">Аватар</label>
                <label class="avatar-upload-btn">
                  <input class="avatar-input" type="file" accept="image/*" @change="onCreateRoomAvatarInputChange" />
                  <ImagePlus :size="16" />
                  <span>{{ roomCreateAvatarPath ? 'Сменить аватар' : 'Загрузить аватар' }}</span>
                </label>
                <div v-if="roomCreateAvatarPath" class="room-avatar-preview-row">
                  <img class="room-avatar room-avatar-preview" :src="resolveMediaUrl(roomCreateAvatarPath)" alt="room avatar preview" />
                </div>
                <label class="field-label">Видимость</label>
                <select v-model="roomCreateVisibility" class="field-input select-input">
                  <option value="public">public</option>
                  <option value="private">private</option>
                </select>
                <label class="toggle-row">
                  <input v-model="roomCreateCommentsEnabled" type="checkbox" />
                  <span>Разрешить комментарии</span>
                </label>
                <label class="toggle-row">
                  <input v-model="roomCreatePostOnlyByAdmin" type="checkbox" />
                  <span>Писать может только админ</span>
                </label>
                <button class="btn" :disabled="roomCreating" @click="onCreateRoom">
                  <Plus :size="16" />
                  <span>{{ roomCreating ? 'Создаю...' : 'Создать' }}</span>
                </button>
                <div v-if="roomSaveError" class="error">{{ roomSaveError }}</div>
                </div>
              </template>
              <template v-else>
                <button class="btn create-room-btn" @click="onGoOwnRoomsForCreate">
                  <Plus :size="16" />
                  <span>Создать свою комнату</span>
                </button>
              </template>
            </div>

            <div class="rooms-main">
              <div v-if="selectedRoom" class="room-details">
                <div class="room-head">
                  <button
                    v-if="selectedRoomDisplayAvatarUrl"
                    class="media-viewer-trigger"
                    type="button"
                    @click="openMediaViewer(selectedRoomDisplayAvatarUrl, selectedRoomDisplayTitle)"
                  >
                    <img
                      class="room-avatar room-avatar-lg"
                      :src="selectedRoomDisplayAvatarUrl"
                      :alt="selectedRoomDisplayTitle"
                    />
                  </button>
                  <div v-else class="room-avatar room-avatar-fallback room-avatar-lg">
                    {{ roomAvatarFallback(selectedRoom) }}
                  </div>
                  <div class="room-head-text">
                    <div class="profile-name-row">
                      <div class="profile-name">{{ selectedRoomDisplayTitle }}</div>
                    </div>
                    <div class="profile-nickname">#room-{{ selectedRoom.id }}</div>
                    <div class="profile-info">
                      {{ selectedRoom.visibility === 'private' ? 'private' : 'public' }}
                      · {{ selectedRoom.commentsEnabled ? 'комментарии включены' : 'без комментариев' }}
                      · {{ selectedRoom.postOnlyByAdmin ? 'пишет только админ' : 'писать могут все' }}
                    </div>
                  </div>
                </div>

                <template v-if="canEditSelectedRoom">
                  <div class="section-title">Настройки комнаты</div>
                  <label class="field-label">Название</label>
                  <input v-model="roomTitle" class="field-input" type="text" placeholder="Комната" />
                  <label class="field-label">Аватар</label>
                  <label class="avatar-upload-btn">
                    <input class="avatar-input" type="file" accept="image/*" @change="onRoomAvatarInputChange" />
                    <ImagePlus :size="16" />
                    <span>Сменить аватар</span>
                  </label>
                  <label class="field-label">Видимость</label>
                  <select v-model="roomVisibility" class="field-input select-input">
                    <option value="public">public</option>
                    <option value="private">private</option>
                  </select>
                  <label class="toggle-row">
                    <input v-model="roomCommentsEnabled" type="checkbox" />
                    <span>Разрешить комментарии</span>
                  </label>
                  <label class="toggle-row">
                    <input v-model="roomPostOnlyByAdmin" type="checkbox" />
                    <span>Писать может только админ</span>
                  </label>
                  <div class="action-row">
                    <button class="btn" :disabled="roomSaving" @click="onSaveRoom">
                      <Save :size="16" />
                      <span>{{ roomSaving ? 'Сохраняю...' : 'Сохранить комнату' }}</span>
                    </button>
                  </div>
                  <div v-if="roomSaveSuccess" class="success">{{ roomSaveSuccess }}</div>
                  <div v-if="roomSaveError" class="error">{{ roomSaveError }}</div>
                </template>
                <template v-else-if="canLeaveSelectedRoom">
                  <div class="action-row room-leave-row">
                    <button class="ghost-btn danger-btn" :disabled="roomLeaveBusy" @click="onLeaveSelectedRoom">
                      <UserRoundMinus :size="16" />
                      <span>{{ roomLeaveBusy ? 'Выходим...' : 'Покинуть комнату' }}</span>
                    </button>
                  </div>
                </template>

                <div class="section-title">Участники</div>
                <div v-if="roomMembersLoading" class="hint">Загружаю участников...</div>
                <div v-else-if="sortedRoomMembers.length" class="member-list">
                  <div v-for="member in sortedRoomMembers" :key="`member-${member.id}`" class="member-item">
                    <span class="member-status" :class="{online: member.isOnline}" />
                    <img
                      v-if="resolveUserAvatarUrl(member)"
                      class="room-avatar room-avatar-sm"
                      :src="resolveUserAvatarUrl(member)"
                      :alt="member.name"
                    />
                    <div v-else class="room-avatar room-avatar-fallback room-avatar-sm">
                      {{ userAvatarFallback(member) }}
                    </div>
                    <div class="member-text">
                      <div class="member-name-row">
                        <span v-if="isSystemNickname(member.nickname)" class="system-star">★</span>
                        <span class="member-name" :style="{color: member.nicknameColor || undefined}">{{ member.name }}</span>
                      </div>
                      <div class="member-nickname">@{{ member.nickname }}</div>
                    </div>
                    <button
                      v-if="canKickRoomMember(member)"
                      class="ghost-btn danger-btn member-kick-btn"
                      :disabled="isRoomMemberActionBusy(member.id)"
                      @click="onKickRoomMember(member)"
                    >
                      <UserRoundMinus :size="14" />
                      <span>{{ isRoomMemberActionBusy(member.id) ? '...' : 'Выкинуть' }}</span>
                    </button>
                  </div>
                </div>
                <div v-else class="hint">Пока пусто</div>
              </div>
              <div v-else class="hint">Выбери комнату слева.</div>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'vpn'" class="console-card">
          <section class="block">
            <h2>Установка приложения</h2>
            <PwaInstallCard class="vpn-pwa-install" />
          </section>

          <section class="block">
            <h2>Proxy для Telegram</h2>
            <div class="links">
              <a class="vpn-link" :href="mtProxyDeepLink" target="_blank" rel="noopener noreferrer">{{ mtProxyDeepLink }}</a>
              <a class="vpn-link" :href="mtProxyWebLink" target="_blank" rel="noopener noreferrer">{{ mtProxyWebLink }}</a>
            </div>
          </section>

          <section class="block">
            <h2>AmneziaVPN</h2>
            <div class="downloads">
              <a class="download-btn" :class="{disabled: !downloadHrefAndroid}" :href="downloadHrefAndroid || '#'" :download="amneziaFileAndroid || undefined" @click.prevent="onDownloadClick(downloadHrefAndroid)">Android</a>
              <a class="download-btn" :class="{disabled: !downloadHrefWindows}" :href="downloadHrefWindows || '#'" :download="amneziaFileWindows || undefined" @click.prevent="onDownloadClick(downloadHrefWindows)">Windows</a>
              <a class="download-btn" :class="{disabled: !downloadHrefMacOs}" :href="downloadHrefMacOs || '#'" :download="amneziaFileMacOs || undefined" @click.prevent="onDownloadClick(downloadHrefMacOs)">Mac OS</a>
              <a class="download-btn" :class="{disabled: !downloadHrefLinux}" :href="downloadHrefLinux || '#'" :download="amneziaFileLinux || undefined" @click.prevent="onDownloadClick(downloadHrefLinux)">Linux</a>
            </div>

            <hr class="vpn-divider" />

            <div v-if="vpnProvisionState === 'error'" class="error">{{ vpnProvisionError }}</div>
            <div class="vpn-actions">
              <button class="btn" type="button" :disabled="vpnProvisionState === 'loading'" @click="requestVpnProvision">
                <ShieldCheck :size="16" />
                <span>{{ vpnProvisionState === 'loading' ? 'Получаем VPN...' : 'Получить конфиг VPN' }}</span>
              </button>
            </div>

            <div v-if="vpnProvisionState === 'success'" class="vpn-result">
              <p class="hint">Ссылка для импорта. Нажми, чтобы скопировать.</p>
              <button class="mono-link" type="button" title="Скопировать VPN-ссылку" @click="copyVpnLink">{{ vpnProvisionLink }}</button>
              <div v-if="copiedVpnLink" class="success">Ссылка скопирована.</div>
              <div v-if="copyVpnError" class="error">{{ copyVpnError }}</div>

              <p class="hint">QR для импорта:</p>
              <div v-if="vpnProvisionQrDataUrl" class="qr-wrap">
                <img class="qr-image" :src="vpnProvisionQrDataUrl" alt="VPN QR code" />
              </div>
              <div v-else-if="vpnProvisionQrError" class="error">{{ vpnProvisionQrError }}</div>
            </div>
          </section>
        </div>

        <div v-else class="console-card">
          <div v-if="!isAuthed" class="hint">
            Для инвайтов нужна авторизация.
          </div>
          <template v-else>
            <section class="block">
              <h2>Доступные комнаты для приглашаемого пользователя</h2>
              <div v-if="inviteRoomsLoading" class="hint">Загружаю комнаты...</div>
              <div v-else class="invite-rooms">
                <label v-for="room in inviteRooms" :key="room.roomId" class="invite-room-item">
                  <input v-model="selectedInviteRoomIds" type="checkbox" :value="room.roomId" />
                  <span>{{ room.title }}</span>
                  <span class="invite-room-meta">{{ room.visibility }}</span>
                </label>
              </div>
              <button class="btn" type="button" :disabled="inviteCreating" @click="onCreateInvite">
                <Plus :size="16" />
                <span>{{ inviteCreating ? 'Создаю...' : 'Создать инвайт' }}</span>
              </button>
              <div v-if="inviteError" class="error">{{ inviteError }}</div>
              <div v-if="lastInviteLink" class="invite-link-card">
                <div class="hint">Последняя ссылка</div>
                <button class="mono-link" type="button" @click="copyInviteLink(lastInviteLink)">{{ lastInviteLink }}</button>
              </div>
            </section>

            <section class="block">
              <h2>Активные инвайты</h2>
              <div v-if="invites.length" class="invite-list">
                <div v-for="invite in invites" :key="invite.id" class="invite-list-item">
                  <div class="invite-list-top">
                    <span class="invite-code">{{ invite.code }}</span>
                    <span class="invite-used">Доступен</span>
                  </div>
                  <div class="invite-list-rooms">
                    {{ (invite.rooms || []).map(room => room.title).join(', ') || 'Комнаты не выбраны' }}
                  </div>
                  <div class="action-row">
                    <button class="ghost-btn" type="button" @click="copyInviteCode(invite.code)">
                      <Copy :size="16" />
                      <span>Копировать</span>
                    </button>
                    <button class="ghost-btn danger-btn" type="button" @click="onDeleteInvite(invite.id)">
                      <Trash2 :size="16" />
                      <span>Удалить</span>
                    </button>
                  </div>
                </div>
              </div>
              <div v-else class="hint">Инвайтов пока нет.</div>
            </section>
          </template>
        </div>

        <div class="console-card donation-card">
          <div class="section-title">Поддержка проекта</div>
          <p class="hint">Отправить пожертвование для сервера и разработки:</p>
          <div class="donation-contact" v-if="donationPhone || donationBank">
            <button v-if="donationPhone" class="mono-link donation-phone" type="button" title="Скопировать телефон" @click="copyDonationPhone">
              {{ donationPhone }}
            </button>
            <div v-if="copiedDonationPhone" class="success">Телефон скопирован.</div>
            <div v-if="donationBank" class="donation-bank">{{ donationBank }}</div>
          </div>
          <div class="hint" v-else-if="vpnInfoLoading">Загрузка реквизитов...</div>
          <div class="error" v-else-if="vpnInfoError">{{ vpnInfoError }}</div>

          <button class="done-btn" :class="{'done-btn-undo': donationButtonUndoMode}" type="button" @click="onDonationButtonClick">
            <span class="done-check">✔</span>
            {{ donationButtonText }}
          </button>
          <div v-if="donationActionError" class="error">{{ donationActionError }}</div>
        </div>
      </template>
    </div>

    <div v-if="avatarCropVisible" class="avatar-crop-overlay" @click.self="onAvatarCropOverlayClick">
      <div class="avatar-crop-card">
        <div class="section-title avatar-crop-title">Выбери область аватарки</div>
        <div class="avatar-crop-stage" @pointerdown.prevent="onAvatarCropPointerDown">
          <img
            v-if="avatarCropSourceUrl"
            class="avatar-crop-image"
            :src="avatarCropSourceUrl"
            :style="avatarCropImageStyle"
            alt="avatar crop"
            draggable="false"
          />
          <div class="avatar-crop-mask" />
        </div>
        <div class="avatar-crop-controls">
          <input
            class="avatar-crop-range"
            type="range"
            :min="avatarCropMinScale"
            :max="avatarCropMaxScale"
            :step="Math.max(avatarCropMinScale / 100, 0.001)"
            :value="avatarCropScale"
            @input="onAvatarCropScaleInput"
          />
          <span class="hint">Масштаб: {{ avatarCropScalePercent }}%</span>
        </div>
        <div class="action-row">
          <button class="ghost-btn" type="button" :disabled="avatarCropBusy" @click="closeAvatarCropper">Отмена</button>
          <button class="btn" type="button" :disabled="avatarCropBusy" @click="finalizeAvatarCropAndUpload">
            <Save :size="16" />
            <span>{{ avatarCropBusy ? 'Сохраняю...' : 'Применить' }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="mediaViewerVisible" class="media-viewer-overlay" @click.self="closeMediaViewer">
      <button class="media-viewer-close" type="button" @click="closeMediaViewer">Закрыть</button>
      <img class="media-viewer-image" :src="mediaViewerSrc" :alt="mediaViewerAlt || 'image'" />
    </div>

    <div v-if="copyToastVisible" class="console-copy-toast">
      {{ copyToastText }}
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
