<template>
        <div class="console-card">
          <div v-if="!isAuthed" class="hint">
            Для инвайтов нужна авторизация.
          </div>
          <template v-else>
            <section class="block">
              <h2>Доступные комнаты для приглашаемого пользователя</h2>
              <div v-if="inviteRoomsLoading" class="hint">Загружаю комнаты...</div>
              <div v-else class="invite-rooms">
                <label v-for="room in inviteRooms" :key="room.roomId" class="invite-room-item">
                  <input v-model="localSelectedInviteRoomIds" type="checkbox" :value="room.roomId" />
                  <span>{{ room.title }}</span>
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
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
