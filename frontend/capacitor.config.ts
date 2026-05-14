import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.core5.marx',
  appName: 'MARX',
  webDir: '.output/public',
  server: {
    androidScheme: 'https',
  },
};

export default config;
