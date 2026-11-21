import { test as base, expect, chromium, type Page } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const isAndroid = process.env.SUITEMAIL_ANDROID === '1';
const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.env.ANDROID_SERIAL || 'emulator-5554';
const adbRun = (...args: string[]) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' });

export const test = isAndroid ? base.extend({
  page: async ({}, use, testInfo) => {
    adbRun('reverse', 'tcp:3333', 'tcp:3333');
    adbRun('reverse', 'tcp:3334', 'tcp:3334');
    adbRun('shell', 'am', 'force-stop', 'com.suitemail.app');
    adbRun('shell', 'am', 'start', '-W', '-n', 'com.suitemail.app/.MainActivity');
    const pid = adbRun('shell','pidof','com.suitemail.app').trim();
    if (!/^\d+$/.test(pid)) throw new Error('SuiteMail did not start');
    adbRun('forward','tcp:9223',`localabstract:webview_devtools_remote_${pid}`);
    let ready = false;
    for (let attempt=0;attempt<60;attempt++) {
      try { const response = await fetch('http://127.0.0.1:9223/json/version'); if(response.ok){ready=true;break;} } catch {}
      await new Promise(r=>setTimeout(r,250));
    }
    if (!ready) throw new Error('SuiteMail WebView debugging endpoint did not start');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
    const context = browser.contexts()[0]!;
    const page: Page = context.pages()[0] || await context.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:5});
    const locatorPrototype = Object.getPrototypeOf(page.locator('body'));
    const originalTap = locatorPrototype.tap;
    locatorPrototype.tap = async function(options: {timeout?: number} = {}) {
      await this.waitFor({state:'visible',timeout:options.timeout});
      await this.scrollIntoViewIfNeeded();
      const box = await this.boundingBox();
      if (!box) throw new Error('Touch target has no bounds');
      await page.waitForTimeout(Number(process.env.SLOW_MO || 350));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    };
    // Existing desktop scenarios use a local dev URL. Android always loads the
    // bundled interface from its installed APK, including after a reload.
    const goto = page.goto.bind(page);
    page.goto = (async (url: string, options?: Parameters<Page['goto']>[1]) => {
      await goto(url.replace('http://localhost:1420', 'https://localhost'), options);
      // Hash-only navigation does not execute init scripts; force a document load.
      return page.reload(options);
    }) as Page['goto'];
    // Fixtures replace external mail/AI and database services only in the test
    // WebView. No fake bridge or fixture data is packaged into the application.
    const addInitScript = page.addInitScript.bind(page);
    page.addInitScript = (async (script: string | Function | { path?: string; content?: string }, arg?: unknown) => {
      if (typeof script !== 'string') return addInitScript(script as never, arg);
      await addInitScript(`${script}\n(() => {
        const fixtureBridge = window.supermail;
        fixtureBridge.isElectron = false;
        Object.defineProperty(window, 'supermail', {
          configurable: true, get: () => fixtureBridge,
          set: value => { window.__nativeSuiteMail = value; }
        });
      })();`);
    }) as Page['addInitScript'];
    const outputDir = path.resolve('recordings/android');
    fs.mkdirSync(outputDir, { recursive: true });
    const title = testInfo.title;
    const number = title.match(/^(\d+)\./)?.[1]?.padStart(2,'0');
    const name = (title.split(':')[0] || title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const filename = `${number ? 'storyboard-' : 'workflow-'}${name}.mp4`;
    const remote = '/sdcard/suitemail-storyboard.mp4';
    adbRun('shell','rm','-f',remote);
    let recordingPid = '';
    const recorder = spawn(adb,['-s',serial,'shell',`echo $$; exec screenrecord --bit-rate 4000000 --time-limit 180 ${remote}`],{stdio:['ignore','pipe','ignore']});
    recorder.stdout.on('data',chunk=>{ if(!recordingPid) recordingPid=chunk.toString().trim().split(/\s+/)[0]; });
    const recorded = new Promise<void>(r => recorder.once('exit',()=>r()));
    await new Promise(r => setTimeout(r,800));
    try {
      await use(page);
      await page.waitForTimeout(1000);
    } finally {
      try {
        try { if (/^\d+$/.test(recordingPid)) adbRun('shell','kill','-2',recordingPid); } catch {}
        await Promise.race([recorded,new Promise(r => setTimeout(r,3000))]);
        const output = path.join(outputDir,filename);
        fs.writeFileSync(output.replace(/\.mp4$/,'.png'), execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:16*1024*1024}));
        adbRun('pull',remote,output);
        const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}));
        const video = probe.streams.find((s: {codec_type: string})=>s.codec_type==='video');
        if (!video || Number(probe.format.duration) <= 0) throw new Error(`Invalid recording: ${output}`);
        await testInfo.attach('Android MP4', {path:output, contentType:'video/mp4'});
        const reportPath = path.join(outputDir,'manifest.json');
        const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath,'utf8')) : [];
        report.push({title,status:testInfo.status,expectedStatus:testInfo.expectedStatus,file:filename,duration:Number(probe.format.duration),width:video.width,height:video.height,codec:video.codec_name,device:serial});
        fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
      } finally {
        locatorPrototype.tap = originalTap;
        await browser.close();
        adbRun('forward','--remove','tcp:9223');
      }
    }
  },
}) : base;
export { expect };
