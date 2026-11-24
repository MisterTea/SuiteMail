import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.suitemail.app',
  appName: 'SuiteMail',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    // Capacitor debug logging includes plugin arguments and sign-in credentials.
    loggingBehavior: process.env.ANDROID_PROTON_BRIDGE === '1' ? 'none' : 'debug',
  },
};
export default config;
