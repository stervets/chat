<template>
  <div class="page page-vpn">
    <div class="vpn-shell">
      <img
        class="project-logo"
        src="/marx_logo.png"
        alt="MARX logo"
        loading="eager"
        decoding="async"
      />

      <div class="vpn-card">
        <h1>VPN и прокси</h1>
        <p class="lead">
          Информация об актуальных ссылках VPN и прокси для Telegram.
        </p>

        <section class="block">
          <h2>MTProxy для Telegram</h2>
          <p class="muted">
            Прокси может поначалу долго соединяться (около минуты).
          </p>
          <div class="links">
            <a
              class="vpn-link"
              :href="mtProxyDeepLink"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ mtProxyDeepLink }}
            </a>
            <a
              class="vpn-link"
              :href="mtProxyWebLink"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ mtProxyWebLink }}
            </a>
          </div>
        </section>

        <section class="block">
          <h2>AmneziaVPN</h2>
          <p class="muted">
            Для установки VPN установить клиент Amnezia и импортировать эту ссылку:
          </p>

          <button
            class="mono-link"
            type="button"
            title="Скопировать ссылку конфигурации"
            @click="copyAmneziaConfigUri"
          >
            {{ amneziaConfigUri }}
          </button>
          <div v-if="copiedConfigUri" class="copied-hint">Ссылка скопирована в буфер обмена.</div>

          <div class="downloads">
            <a
              class="download-btn"
              :class="{disabled: !downloadHrefWindows}"
              :href="downloadHrefWindows || '#'"
              :download="amneziaFileWindows || undefined"
              @click.prevent="onDownloadClick(downloadHrefWindows)"
            >
              Скачать для Windows
            </a>
            <a
              class="download-btn"
              :class="{disabled: !downloadHrefLinux}"
              :href="downloadHrefLinux || '#'"
              :download="amneziaFileLinux || undefined"
              @click.prevent="onDownloadClick(downloadHrefLinux)"
            >
              Скачать для Linux
            </a>
            <a
              class="download-btn"
              :class="{disabled: !downloadHrefAndroid}"
              :href="downloadHrefAndroid || '#'"
              :download="amneziaFileAndroid || undefined"
              @click.prevent="onDownloadClick(downloadHrefAndroid)"
            >
              Скачать для Android
            </a>
          </div>
        </section>

        <section class="block">
          <h2>Поддержка проекта</h2>
          <p class="muted">Отправить пожертвование для поддержки сервера и дальнейшей разработки:</p>
          <div class="donation-contact" v-if="donationPhone || donationBank">
            <button
              v-if="donationPhone"
              class="mono-link donation-phone"
              type="button"
              title="Скопировать телефон для пожертвования"
              @click="copyDonationPhone"
            >
              {{ donationPhone }}
            </button>
            <div v-if="copiedDonationPhone" class="copied-hint">Телефон скопирован в буфер обмена.</div>
            <div v-if="donationBank" class="donation-bank">{{ donationBank }}</div>
          </div>
          <div class="muted" v-else-if="vpnInfoLoading">Загрузка реквизитов...</div>
          <div class="error" v-else-if="vpnInfoError">{{ vpnInfoError }}</div>
        </section>

        <button
          class="done-btn"
          :class="{'done-btn-undo': donationButtonUndoMode}"
          type="button"
          @click="onDonationButtonClick"
        >
          <span class="done-check">✔</span>
          {{ donationButtonText }}
        </button>
        <div v-if="donationActionError" class="error">{{ donationActionError }}</div>

        <button class="back-chat-btn" type="button" @click="onBackToChat">
          В чат
        </button>
      </div>
    </div>
  </div>
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
