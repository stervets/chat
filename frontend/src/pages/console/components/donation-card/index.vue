<template>
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

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
