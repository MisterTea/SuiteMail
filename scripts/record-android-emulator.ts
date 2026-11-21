/** Run all storyboard scenarios in the installed APK and record the emulator. */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const sdk = process.env.ANDROID_HOME || path.join(os.homedir(),'Library/Android/sdk');
const adb = path.join(sdk,'platform-tools',process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.env.ANDROID_SERIAL || 'emulator-5554';
const apk = path.resolve('dist-android/SuiteMail-0.1.0-android-debug.apk');
execFileSync(adb,['-s',serial,'wait-for-device']);
execFileSync(adb,['-s',serial,'install','-r',apk],{stdio:'inherit'});
fs.mkdirSync('recordings/android',{recursive:true});
if (!process.argv.slice(2).length) fs.writeFileSync('recordings/android/manifest.json','[]');
const result = spawnSync('npx',['playwright','test','--config=playwright.android.config.ts',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,SUITEMAIL_ANDROID:'1',ANDROID_SERIAL:serial}});
execFileSync(process.execPath,[path.resolve('scripts/android-report.mjs')],{stdio:'inherit'});
process.exit(result.status ?? 1);
