#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const output = path.resolve('recordings/android');
const reportPath = path.join(output, 'manifest.json');
const reviewSource = path.resolve('docs/android-ux');
if (fs.existsSync(reviewSource)) fs.cpSync(reviewSource, path.join(output, 'ux-review'), {recursive:true});
const entries = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const latest = [...new Map(entries.map(entry => [entry.title, entry])).values()];
for (const entry of latest) {
  entry.sha256 = createHash('sha256').update(fs.readFileSync(path.join(output, entry.file))).digest('hex');
}
fs.writeFileSync(reportPath, JSON.stringify(latest, null, 2));
const escape = text => text.replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const cards = latest.map(entry => `<article><h2>${escape(entry.title)}</h2><p>${escape(entry.status)} · ${entry.duration.toFixed(1)} seconds · ${entry.width} × ${entry.height}</p><video controls preload="none" poster="${encodeURI(entry.file.replace(/\.mp4$/, '.png'))}" src="${encodeURI(entry.file)}"></video><p><a href="${encodeURI(entry.file)}" download>Download MP4</a></p></article>`).join('');
fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SuiteMail Android storyboards</title><style>body{margin:0;padding:32px;background:#f4f7f5;color:#18372b;font:16px system-ui}main{max-width:1200px;margin:auto}h1{font-size:32px}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}article{background:white;border:1px solid #dce7df;border-radius:16px;padding:20px}h2{font-size:18px;min-height:70px}p{color:#55675b;font-size:14px}video{width:100%;max-height:600px;background:#edf2ee;border-radius:8px}a{color:#188038}</style><main><h1>SuiteMail on Android</h1><p>${latest.filter(e=>e.status==='passed').length} of ${latest.length} scenarios passed. Recorded from the installed APK on an Android emulator. Workflow scenarios use controlled email and AI fixtures; the native backend scenario exercises real SQLite, IMAP, SMTP, and private files.</p>${fs.existsSync(reviewSource) ? '<p><a href="ux-review/README.md">Read the 24 storyboard design reviews and implementation notes</a></p>' : ''}<section>${cards}</section></main></html>`);
console.log(`Recorded ${latest.length} scenarios. Open recordings/android/index.html.`);
