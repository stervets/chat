<template>
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
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
