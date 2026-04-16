import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const isDevelopmentMode = process.argv.some((arg) => arg.includes('dev'));
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const fileConfig = JSON.parse(readFileSync(resolve(rootDir, 'config.json'), 'utf-8'));
const apiUrl = fileConfig.apiUrl;
const wsPath = fileConfig.wsPath || '/ws';
const wsUrl = fileConfig.wsUrl || (() => {
  const api = new URL(apiUrl);
  api.protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
  api.pathname = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  api.search = '';
  api.hash = '';
  return api.toString();
})();
const config = {
  ...fileConfig,
  wsPath,
  wsUrl
};

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

  vite: {
    server: {
      host: '0.0.0.0',
      port: 8815,
      strictPort: true,
      proxy: {
        [wsPath]: {
          target: apiUrl,
          changeOrigin: true,
          ws: true
        }
      }
    }
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
      title: 'MARX',
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
