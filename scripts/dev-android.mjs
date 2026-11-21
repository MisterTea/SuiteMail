#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library/Android/sdk');
const javaHome = process.env.JAVA_HOME || (process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : undefined);
const env = {...process.env, ANDROID_HOME:sdk, ...(javaHome ? {JAVA_HOME:javaHome} : {}), PATH:[path.join(os.homedir(),'.cargo/bin'), ...(javaHome ? [path.join(javaHome,'bin')] : []), process.env.PATH].join(path.delimiter)};
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const gradle = path.join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const configPath = path.join(root,'android/app/src/main/assets/capacitor.config.json');
const apk = path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk');
const args = process.argv.slice(2);
if (args.some(arg=>arg !== '--native')) throw new Error('Usage: npm run dev:android [-- --native]. Select a device with ANDROID_SERIAL.');
let serial, server, child, originalConfig, forwarded = false, installed = false, stopping = false, restoring = false;
let finish;
const stopped = new Promise(resolve=>{finish=resolve;});
function stop() {
  if (restoring) return;
  stopping = true;
  child?.kill('SIGINT');
  finish();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
async function run(command, argv, capture = false) {
  if (stopping && !restoring) throw new Error('Development session stopped');
  return new Promise((resolve,reject)=>{
    let output = '';
    const proc = spawn(command, argv, {cwd:root,env,stdio:capture ? ['ignore','pipe','inherit'] : 'inherit'});
    child = proc;
    if (capture) proc.stdout.on('data',chunk=>{output+=chunk;});
    proc.once('error',reject);
    proc.once('exit',(code,signal)=>{
      if (child === proc) child = undefined;
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${path.basename(command)} failed (${signal || code})`));
    });
  });
}
const device = (...argv)=>run(adb,['-s',serial,...argv]);
const assemble = ()=>run(gradle,['-p','android',`-PsuiteMailAbis=${process.env.ANDROID_ABIS || 'arm64-v8a'}`,'assembleDebug']);
const launch = async ()=>{
  await device('shell','am','force-stop','com.suitemail.app');
  await device('shell','am','start','-W','-n','com.suitemail.app/.MainActivity');
};
try {
  const devices = (await run(adb,['devices'],true)).split(/\r?\n/).slice(1).filter(line=>/\sdevice$/.test(line)).map(line=>line.split(/\s/)[0]);
  serial = process.env.ANDROID_SERIAL || (devices.length === 1 ? devices[0] : undefined);
  if (!serial || !devices.includes(serial)) throw new Error('Start an emulator or connect an authorized USB device. If several are connected, set ANDROID_SERIAL.');
  // Only a first run or an explicit native rebuild needs the Rust/web packaging pipeline.
  const abis = (process.env.ANDROID_ABIS || 'arm64-v8a').split(',');
  if (args.includes('--native') || !fs.existsSync(path.join(root,'dist/index.html')) || abis.some(abi=>!fs.existsSync(path.join(root,'android/app/src/main/jniLibs',abi,'libsupermail_android.so')))) {
    console.log('Preparing native libraries and bundled fallback…');
    await run(process.execPath,['scripts/build-android.mjs']);
  }
  server = await createServer({root,mode:'android',server:{host:'127.0.0.1',port:1420,strictPort:true,hmr:{host:'localhost',protocol:'ws',port:1420,clientPort:1420}}});
  await server.listen();
  await device('reverse','tcp:1420','tcp:1420');
  forwarded = true;
  await run(npx,['cap','sync','android']);
  originalConfig = fs.readFileSync(configPath);
  const config = JSON.parse(originalConfig);
  config.server = {...config.server,url:'http://localhost:1420',cleartext:true};
  config.android = {...config.android,allowMixedContent:true};
  try {
    fs.writeFileSync(configPath,JSON.stringify(config));
    await assemble();
  } finally {
    // The URL exists only in this debug APK, never in the source config or next build.
    fs.writeFileSync(configPath,originalConfig);
  }
  installed = true;
  await device('install','-r',apk);
  await launch();
  console.log('\nSuiteMail live reload is running. Edit src/ to update Android immediately.');
  console.log('Native/Rust changes: restart with npm run dev:android -- --native.');
  console.log('Ctrl+C restores and launches the bundled app; keep the device connected.\n');
  if (!stopping) await stopped;
} catch (error) {
  if (!stopping) { console.error(error.message); process.exitCode = 1; }
} finally {
  restoring = true;
  if (originalConfig) fs.writeFileSync(configPath,originalConfig);
  if (installed) {
    try {
      console.log('\nRestoring the bundled Android app…');
      await assemble();
      await device('install','-r',apk);
      await launch();
    } catch (error) {
      console.error(`Could not restore the device: ${error.message}. Reconnect and run npm run dev:android, then stop it normally.`);
      process.exitCode = 1;
    }
  }
  if (forwarded) {
    try {await device('reverse','--remove','tcp:1420');} catch {}
  }
  await server?.close();
  process.removeListener('SIGINT',stop);
  process.removeListener('SIGTERM',stop);
}
