<template>
        <div class="console-card">
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
</template>

<script src="./script.ts" lang="ts"/>
<style src="./style.less" lang="less" scoped/>
