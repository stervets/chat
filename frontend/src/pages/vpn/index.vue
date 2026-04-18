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
        <PwaInstallCard class="vpn-pwa-install"/>

        <section class="block">
          <h2>Proxy для Telegram</h2>
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

          <div class="downloads">
            <a
              class="download-btn"
              :class="{disabled: !downloadHrefAndroid}"
              :href="downloadHrefAndroid || '#'"
              :download="amneziaFileAndroid || undefined"
              @click.prevent="onDownloadClick(downloadHrefAndroid)"
            >
              Скачать для Android
            </a>
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
              :class="{disabled: !downloadHrefMacOs}"
              :href="downloadHrefMacOs || '#'"
              :download="amneziaFileMacOs || undefined"
              @click.prevent="onDownloadClick(downloadHrefMacOs)"
            >
              Скачать для Mac OS
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
          </div>

          <hr style='margin: 20px 25% 20px 25%; opacity: .1; width: 50%;'>
          
          <div v-if="vpnProvisionState === 'error'" class="error">{{ vpnProvisionError }}</div>
          <div class="vpn-actions">
            <button
              class="download-btn get-vpn"
              type="button"
              :disabled="vpnProvisionState === 'loading'"
              @click="requestVpnProvision"
            >
              {{ vpnProvisionState === 'loading' ? 'Получаем VPN...' : 'Получить конфиг VPN' }}
            </button>
          </div>

          <div v-if="vpnProvisionState === 'success'" class="vpn-result">
            <p class="muted">Ссылка для импорта (нажать, чтобы скопировать). В клиенте вставить ссылку или сканировать QR-код.</p>
            <button
              class="mono-link"
              type="button"
              title="Скопировать VPN-ссылку"
              @click="copyVpnLink"
            >
              {{ vpnProvisionLink }}
            </button>

            <div v-if="copiedVpnLink" class="copied-hint">Ссылка скопирована в буфер обмена.</div>
            <div v-if="copyVpnError" class="error">{{ copyVpnError }}</div>

            <p class="muted">QR для импорта:</p>
            <div v-if="vpnProvisionQrDataUrl" class="qr-wrap">
              <img class="qr-image" :src="vpnProvisionQrDataUrl" alt="VPN QR code">
            </div>
            <div v-else-if="vpnProvisionQrError" class="error">{{ vpnProvisionQrError }}</div>
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
