import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const isDevelopmentMode = process.argv.some((arg) => arg.includes('dev'));
const config = JSON.parse(
  readFileSync(resolve(process.cwd(), 'config.json'), 'utf-8')
);

export default defineNuxtConfig({
  modules: [
    '@nuxtjs/tailwindcss',
    '@element-plus/nuxt',
  ],

  compatibilityDate: '2026-03-27',

  devtools: {enabled: isDevelopmentMode},
  sourcemap: isDevelopmentMode,

  build: {
    analyze: {
      open: false,
    }
  },

  typescript: {
    shim: false,
  },

  elementPlus: {},

  srcDir: 'src/',

  devServer: {
    host: '0.0.0.0',
    port: 8815
  },

  tailwindcss: {
    exposeConfig: true,
    viewer: true,
  },

  runtimeConfig: {
    public: {
      ...config,
    },
  },

  app: {
    head: {
      title: 'Marx Chat',
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
        },
        {
          name: 'mobile-web-app-capable',
          content: 'yes'
        }
      ],
    },
  },

  ssr: false
});
