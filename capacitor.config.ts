import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.suitemail.app',
  appName: 'SuiteMail',
  webDir: 'dist',
  android: { allowMixedContent: false },
};
export default config;
