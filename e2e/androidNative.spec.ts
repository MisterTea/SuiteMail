import { test, expect } from './fixtures';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test.skip(process.env.SUITEMAIL_ANDROID !== '1', 'Requires installed Android APK');
test('Native Android backend: SQLite persistence, private files, IMAP folders, and SMTP delivery', async ({page}) => {
  let delivered = '';
  const smtp = net.createServer(socket => {
    socket.write('220 localhost SuiteMail test SMTP\r\n');
    let buffer = '', dataMode = false, message = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0,end); buffer = buffer.slice(end+2);
        if (dataMode) {
          if (line === '.') { delivered = message; dataMode = false; socket.write('250 Accepted\r\n'); }
          else message += line+'\r\n';
        } else if (/^EHLO/i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH/i.test(line)) socket.write('235 Authenticated\r\n');
        else if (/^DATA/i.test(line)) { dataMode = true; socket.write('354 Send message\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  const imap = net.createServer(socket => {
    socket.write('* OK SuiteMail test IMAP\r\n');
    let buffer = '';
    socket.on('data',chunk=> {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end=buffer.indexOf('\r\n'); const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const [tag, command] = line.split(' ');
        if (command?.toUpperCase()==='CAPABILITY') socket.write('* CAPABILITY IMAP4rev1\r\n');
        if (command?.toUpperCase()==='LIST') socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');
        if (command?.toUpperCase()==='STATUS') socket.write('* STATUS "INBOX" (MESSAGES 1 UNSEEN 1)\r\n');
        if (command?.toUpperCase()==='LOGOUT') { socket.end(`* BYE Logging out\r\n${tag} OK LOGOUT\r\n`); }
        else socket.write(`${tag} OK ${command} completed\r\n`);
      }
    });
  });
  await Promise.all([new Promise<void>(r=>smtp.listen(2525,'127.0.0.1',r)),new Promise<void>(r=>imap.listen(1143,'127.0.0.1',r))]);
  const adb=path.join(process.env.ANDROID_HOME || path.join(os.homedir(),'Library/Android/sdk'),'platform-tools/adb');
  for(const port of [2525,1143]) execFileSync(adb,['-s',process.env.ANDROID_SERIAL || 'emulator-5554','reverse',`tcp:${port}`,`tcp:${port}`]);
  try {
    await page.goto('https://localhost');
    await page.waitForFunction(async () => {
      try { const rows=await window.supermail?.db?.select<unknown[]>("SELECT name FROM sqlite_master WHERE name='messages_fts'");return rows?.length===1; } catch {return false;}
    });
    const result = await page.evaluate(async () => {
      const bridge = window.supermail!;
      const db = bridge.db!;
      await db.execute('CREATE TABLE IF NOT EXISTS android_smoke (id INTEGER PRIMARY KEY, value TEXT)');
      await db.execute('INSERT OR REPLACE INTO android_smoke (id, value) VALUES (1, $1)', ['persisted on Android']);
      await bridge.fs!.writeTextFile('android-smoke.txt','private Android file');
      const config={host:'127.0.0.1',security:'none',username:'user@test.com',password:'test-only',auth_method:'password'};
      const folders=await bridge.invoke!('imap_list_folders',{config:{...config,port:1143}});
      const raw=btoa('From: user@test.com\r\nTo: recipient@test.com\r\nSubject: Native Android SMTP\r\n\r\nSent by the real Rust backend.\r\n').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const sent=await bridge.invoke!('smtp_send_email',{config:{...config,port:2525},raw_email:raw});
      return {folders,sent,file:await bridge.fs!.readTextFile('android-smoke.txt'),ai:await bridge.invoke!('aicore_is_available')};
    });
    expect(result.file).toBe('private Android file');
    expect(result.ai).toEqual({available:false,supported_models:[]});
    expect(result.folders).toEqual([expect.objectContaining({path:'INBOX',exists:1,unseen:1})]);
    expect(result.sent).toEqual(expect.objectContaining({success:true}));
    expect(delivered).toContain('Subject: Native Android SMTP');
    await page.reload();
    await page.waitForFunction(() => !!window.supermail?.db);
    const rows = await page.evaluate(() => window.supermail!.db!.select('SELECT value FROM android_smoke WHERE id = 1'));
    expect(rows).toEqual([{value:'persisted on Android'}]);
  } finally {
    smtp.close(); imap.close();
  }
});
