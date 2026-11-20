import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function brandElectronMac() {
  if (process.platform !== 'darwin') return;

  const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(electronDist)) return;

  const oldAppPath = path.join(electronDist, 'Electron.app');
  const appPath = path.join(electronDist, 'SuiteMail.app');
  let changed = false;

  // 1. Rename bundle directory to SuiteMail.app
  if (fs.existsSync(oldAppPath)) {
    if (fs.existsSync(appPath)) {
      fs.rmSync(appPath, { recursive: true, force: true });
    }
    fs.renameSync(oldAppPath, appPath);
    changed = true;
  }

  if (!fs.existsSync(appPath)) return;

  // 2. Rename executable inside bundle
  const oldExec = path.join(appPath, 'Contents', 'MacOS', 'Electron');
  const newExec = path.join(appPath, 'Contents', 'MacOS', 'SuiteMail');
  if (fs.existsSync(oldExec)) {
    if (fs.existsSync(newExec)) {
      fs.rmSync(newExec, { force: true });
    }
    fs.renameSync(oldExec, newExec);
    changed = true;
  }

  // 3. Update Info.plist
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  if (fs.existsSync(plistPath)) {
    let plist = fs.readFileSync(plistPath, 'utf8');
    const originalPlist = plist;

    plist = plist.replace(
      /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
      '<key>CFBundleDisplayName</key>\n\t<string>SuiteMail</string>'
    );
    plist = plist.replace(
      /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
      '<key>CFBundleName</key>\n\t<string>SuiteMail</string>'
    );
    plist = plist.replace(
      /<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/,
      '<key>CFBundleIdentifier</key>\n\t<string>com.suitemail.app</string>'
    );
    plist = plist.replace(
      /<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/,
      '<key>CFBundleExecutable</key>\n\t<string>SuiteMail</string>'
    );

    if (plist !== originalPlist) {
      fs.writeFileSync(plistPath, plist, 'utf8');
      changed = true;
    }
  }

  // 4. Update dock icon in bundle resources
  const icnsSource = path.join(rootDir, 'electron', 'icons', 'icon.icns');
  const icnsDest = path.join(appPath, 'Contents', 'Resources', 'electron.icns');
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

  // 5. Update path.txt (MUST NOT HAVE TRAILING NEWLINE)
  const pathTxt = path.join(rootDir, 'node_modules', 'electron', 'path.txt');
  const targetRelativePath = 'SuiteMail.app/Contents/MacOS/SuiteMail';
  if (fs.existsSync(pathTxt)) {
    const currentPath = fs.readFileSync(pathTxt, 'utf8');
    if (currentPath !== targetRelativePath) {
      fs.writeFileSync(pathTxt, targetRelativePath, 'utf8');
      changed = true;
    }
  }

  // 6. Sign and refresh LaunchServices if anything changed
  if (changed) {
    try {
      execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'ignore' });
    } catch {}
    try {
      execSync(`touch "${appPath}"`);
    } catch {}
    const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    if (fs.existsSync(lsregister)) {
      try {
        execSync(`"${lsregister}" -f "${appPath}"`, { stdio: 'ignore' });
      } catch {}
    }
    console.log('[brand-electron] Branded Electron app as SuiteMail');
  }
}

brandElectronMac();
