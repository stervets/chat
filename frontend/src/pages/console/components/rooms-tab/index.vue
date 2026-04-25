<template>
        <div class="console-card">
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
                <input v-model="localRoomCreateTitle" class="field-input" type="text" placeholder="Комната" />
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
                <select v-model="localRoomCreateVisibility" class="field-input select-input">
                  <option value="public">Открытая</option>
                  <option value="private">Закрытая</option>
                </select>
                <label class="toggle-row">
                  <input v-model="localRoomCreateCommentsEnabled" type="checkbox" />
                  <span>Разрешить комментарии</span>
                </label>
                <label class="toggle-row">
                  <input v-model="localRoomCreatePostOnlyByAdmin" type="checkbox" />
                  <span>Канал</span>
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
                  </div>
                </div>

                <template v-if="canEditSelectedRoom">
                  <div class="section-title">Настройки комнаты</div>
                  <label class="field-label">Название</label>
                  <input v-model="localRoomTitle" class="field-input" type="text" placeholder="Комната" />
                  <label class="field-label">Аватар</label>
                  <label class="avatar-upload-btn">
                    <input class="avatar-input" type="file" accept="image/*" @change="onRoomAvatarInputChange" />
                    <ImagePlus :size="16" />
                    <span>Сменить аватар</span>
                  </label>
                  <label class="field-label">Видимость</label>
                  <select v-model="localRoomVisibility" class="field-input select-input">
                    <option value="public">Открытая</option>
                    <option value="private">Закрытая</option>
                  </select>
                  <label class="toggle-row">
                    <input v-model="localRoomCommentsEnabled" type="checkbox" />
                    <span>Разрешить комментарии</span>
                  </label>
                  <label class="toggle-row">
                    <input v-model="localRoomPostOnlyByAdmin" type="checkbox" />
                    <span>Канал</span>
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
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
