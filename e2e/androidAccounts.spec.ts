import { test, expect } from './fixtures';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const adb=path.join(process.env.ANDROID_HOME || path.join(os.homedir(),'Library/Android/sdk'),'platform-tools/adb');
const shell=(...args:string[])=>execFileSync(adb,['-s',process.env.ANDROID_SERIAL || 'emulator-5554','shell',...args],{encoding:'utf8'});

test.skip(process.env.SUITEMAIL_ANDROID !== '1', 'Requires installed Android APK');
test('Android IMAP alternative supports Gmail app passwords and detects Gmail servers', async ({page}) => {
  await page.goto('https://localhost');
  const chooser = page.getByRole('dialog', {name:'Add Account', exact:true});
  await expect(chooser).toBeVisible();
  const google = chooser.getByRole('button', {name:/^IMAP \/ SMTP/});
  await expect(google).toBeEnabled();
  await google.tap();
  const setup = page.getByRole('dialog', {name:'Add IMAP/SMTP Account', exact:true});
  await expect(setup).toBeVisible();
  await setup.getByLabel('Email Address', {exact:true}).fill('android-test@gmail.com');
  await setup.getByLabel('Display Name (optional)', {exact:true}).tap();
  await expect(setup.getByText(/16-character App Password/)).toBeVisible();
  await expect(setup.getByLabel('Password', {exact:true})).toBeVisible();
  await expect(setup.getByRole('button',{name:'Sign in with Google',exact:true})).toHaveCount(0);
  await setup.getByLabel('Password', {exact:true}).fill('test-only-not-a-real-password');
  await setup.getByRole('button', {name:'Next',exact:true}).tap();
  await expect(setup.getByLabel('IMAP Server', {exact:true})).toHaveValue('imap.gmail.com');
  await setup.getByRole('button', {name:'Next',exact:true}).tap();
  await expect(setup.getByLabel('SMTP Server', {exact:true})).toHaveValue('smtp.gmail.com');
  // No connection attempt or account creation: these are deliberately fake credentials.
  await setup.getByRole('button',{name:'Cancel',exact:true}).tap();
});


test('Android Google account choice opens native Google authorization and handles cancellation',async({page})=>{
  await page.goto('https://localhost');
  const countBefore=await page.evaluate(async()=>await window.supermail!.db!.select('SELECT id FROM accounts'));
  await page.getByRole('dialog',{name:'Add Account',exact:true}).getByRole('button',{name:/^Google \(Gmail\)/}).tap();
  const top=()=>shell('dumpsys','activity','activities').split('\n').filter(line=>line.includes('topResumedActivity=')).join('');
  await expect.poll(top,{timeout:30000}).toContain('com.google.android.gms');
  // Let the real Google surface render, but never select an account or grant mail access in this smoke test.
  await page.waitForTimeout(2500);
  for(let i=0;i<4;i++){
    shell('input','keyevent','4');
    await page.waitForTimeout(700);
    if(top().includes('com.suitemail.app')) break;
  }
  await expect(page.getByText('Google account selection was cancelled.',{exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>await window.supermail!.db!.select('SELECT id FROM accounts'))).toEqual(countBefore);
  await expect(page.getByRole('button',{name:'Sign in with Google',exact:true})).toBeEnabled();
});
