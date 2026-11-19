import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function brandElectronMac() {
  if (process.platform !== 'darwin') return;

  const electronAppPath = path.join(rootDir, 'node_modules', 'electron', 'dist', 'Electron.app');
  if (!fs.existsSync(electronAppPath)) return;

  const plistPath = path.join(electronAppPath, 'Contents', 'Info.plist');
  if (fs.existsSync(plistPath)) {
    let plist = fs.readFileSync(plistPath, 'utf8');
    let changed = false;
    const displayNamePattern = /<key>CFBundleDisplayName<\/key>\s*<string>Electron<\/string>/;
    const namePattern = /<key>CFBundleName<\/key>\s*<string>Electron<\/string>/;
    if (displayNamePattern.test(plist) || namePattern.test(plist)) {
      plist = plist.replace(
        /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
        '<key>CFBundleDisplayName</key>\n\t<string>SuiteMail</string>'
      );
      plist = plist.replace(
        /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
        '<key>CFBundleName</key>\n\t<string>SuiteMail</string>'
      );
      fs.writeFileSync(plistPath, plist, 'utf8');
      changed = true;
    }

    const icnsSource = path.join(rootDir, 'electron', 'icons', 'icon.icns');
    const icnsDest = path.join(electronAppPath, 'Contents', 'Resources', 'electron.icns');
    if (fs.existsSync(icnsSource)) {
      try {
        const srcBuf = fs.readFileSync(icnsSource);
        const destBuf = fs.existsSync(icnsDest) ? fs.readFileSync(icnsDest) : null;
        if (!destBuf || !srcBuf.equals(destBuf)) {
          fs.writeFileSync(icnsDest, srcBuf);
          changed = true;
        }
      } catch (err) {
        console.warn('[brand-electron] Could not copy icon.icns:', err.message);
      }
    }

    if (changed) {
      try {
        execSync(`codesign --force --deep --sign - "${electronAppPath}"`, { stdio: 'ignore' });
      } catch {}
      try {
        execSync(`touch "${electronAppPath}"`);
      } catch {}
      console.log('[brand-electron] Branded Electron.app as SuiteMail');
    }
  }
}

brandElectronMac();
