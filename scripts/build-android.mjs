#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library/Android/sdk');
const ndkRoot = process.env.ANDROID_NDK_HOME || path.join(sdk, 'ndk', fs.readdirSync(path.join(sdk, 'ndk')).sort((a,b) => a.localeCompare(b, undefined, {numeric:true})).at(-1));
const host = process.platform === 'darwin' ? 'darwin-x86_64' : process.platform === 'win32' ? 'windows-x86_64' : 'linux-x86_64';
const tools = path.join(ndkRoot, 'toolchains/llvm/prebuilt', host, 'bin');
const javaHome = process.env.JAVA_HOME || (process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : undefined);
const cargoBin = path.join(os.homedir(), '.cargo/bin');
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_NDK_HOME: ndkRoot, ...(javaHome ? {JAVA_HOME: javaHome} : {}), PATH: [cargoBin, ...(javaHome ? [path.join(javaHome,'bin')] : []), process.env.PATH].join(path.delimiter) };
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {cwd:root, env: {...env,...extra}, stdio:'inherit'});
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.error || ''}`);
}
const abis = (process.env.ANDROID_ABIS || 'arm64-v8a').split(',');
const targets = { 'arm64-v8a': ['aarch64-linux-android','aarch64-linux-android'], 'x86_64': ['x86_64-linux-android','x86_64-linux-android'] };
for (const abi of abis) {
  const target = targets[abi];
  if (!target) throw new Error(`Unsupported ABI: ${abi}`);
  const [triple, clang] = target;
  const compiler = path.join(tools, `${clang}26-clang${process.platform === 'win32' ? '.cmd' : ''}`);
  const archEnv = triple.replaceAll('-', '_');
  run('rustup', ['target','add',triple]);
  run('cargo', ['build','-p','supermail_android','--target',triple,'--release'], {
    [`CARGO_TARGET_${archEnv.toUpperCase()}_LINKER`]:compiler,
    [`CC_${archEnv}`]:compiler,
    [`AR_${archEnv}`]:path.join(tools,'llvm-ar'),
  });
  const destination = path.join(root,'android/app/src/main/jniLibs',abi);
  fs.mkdirSync(destination,{recursive:true});
  fs.copyFileSync(path.join(root,'target',triple,'release/libsupermail_android.so'),path.join(destination,'libsupermail_android.so'));
}
run('npx',['tsc','--noEmit']);
run('npx',['vite','build','--mode','android']);
run('npx',['cap','sync','android']);
// A debug APK can access the host fixture service through adb reverse. Release cannot.
const configPath = path.join(root,'android/app/src/main/assets/capacitor.config.json');
const config = JSON.parse(fs.readFileSync(configPath));
config.android.allowMixedContent = true;
fs.writeFileSync(configPath,JSON.stringify(config));
run(path.join(root,'android/gradlew'),['-p','android',`-PsuiteMailAbis=${abis.join(',')}`,'assembleDebug']);
const output = path.join(root,'dist-android');
fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'),path.join(output,'SuiteMail-0.1.0-android-debug.apk'));
console.log(`APK: ${output}/SuiteMail-0.1.0-android-debug.apk`);
