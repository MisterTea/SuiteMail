#!/usr/bin/env node

/**
 * SuiteMail / SuperMail - Storyboard MP4 Recorder
 *
 * Runs the Top 20 Email Workflow Storyboard tests in Playwright with video capture
 * and converts the resulting recordings into universal, high-quality MP4 files using FFmpeg.
 *
 * Usage:
 *   node scripts/record-storyboards.mjs [options]
 *   npm run record:storyboards [-- options]
 *
 * Options:
 *   -s, --storyboard <range>   Storyboard number(s) to record (e.g. "1", "1,3,5", "1-5", "all") [default: "all"]
 *   -o, --output <dir>         Output directory for MP4 files [default: "./recordings"]
 *   --slowmo <ms>              Action delay in ms for human-paced viewing [default: 200]
 *   --width <px>               Recording viewport width [default: 1280]
 *   --height <px>              Recording viewport height [default: 720]
 *   --keep-raw                 Keep original Playwright .webm files
 *   -h, --help                 Show this help message
 */

import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// --- Parse CLI Arguments ---
const args = process.argv.slice(2);

function getArgValue(flag, shortFlag) {
  const index = args.findIndex((arg) => arg === flag || (shortFlag && arg === shortFlag));
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  const prefix = `${flag}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  if (match) {
    return match.slice(prefix.length);
  }
  return null;
}

const hasFlag = (flag, shortFlag) => args.includes(flag) || (shortFlag && args.includes(shortFlag));

if (hasFlag("--help", "-h")) {
  console.log(`
SuiteMail Storyboard MP4 Recorder
=================================

Automates recording video for any or all of the Top 20 E2E Storyboard tests
and encodes them into crisp, universally compatible H.264 MP4 videos.

Usage:
  node scripts/record-storyboards.mjs [options]
  npm run record:storyboards [-- options]

Options:
  -s, --storyboard <id|range>  Storyboard number(s) to record (e.g. "1", "1,3", "1-5", "all") [default: all]
  -o, --output <dir>           Output directory for MP4 files [default: "./recordings"]
  --slowmo <ms>                Action delay in ms for smooth, realistic video [default: 200]
  --width <px>                 Video width [default: 1280]
  --height <px>                Video height [default: 720]
  --keep-raw                   Keep raw .webm files instead of deleting after MP4 encoding
  -h, --help                   Display this help message

Examples:
  npm run record:storyboards                      # Record all 20 storyboards
  npm run record:storyboards -- -s 1              # Record only Storyboard 1
  npm run record:storyboards -- -s 1-5            # Record Storyboards 1 through 5
  npm run record:storyboards -- -s 2,6,10 --slowmo 300 -o ./my-videos
`);
  process.exit(0);
}

const storyboardInput = getArgValue("--storyboard", "-s") || "all";
const outputDir = path.resolve(ROOT_DIR, getArgValue("--output", "-o") || "recordings");
const slowMo = parseInt(getArgValue("--slowmo") || process.env.SLOW_MO || "650", 10);
const videoWidth = parseInt(getArgValue("--width") || "390", 10);
const videoHeight = parseInt(getArgValue("--height") || "844", 10);
const keepRaw = hasFlag("--keep-raw");

// --- Validate FFmpeg ---
function checkFFmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    console.error(`
[ERROR] FFmpeg was not found in your PATH.
FFmpeg is required to convert recordings to MP4 format.

Installation options:
  - Windows: winget install Gyan.FFmpeg
  - macOS:   brew install ffmpeg
  - Linux:   sudo apt install ffmpeg
`);
    process.exit(1);
  }
}

// --- Parse Storyboard Selection ---
function parseStoryboardSelection(input) {
  if (!input || input.toLowerCase() === "all") {
    return null; // all
  }
  const selected = new Set();
  const parts = input.split(",").map((p) => p.trim());
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((n) => parseInt(n.trim(), 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
          selected.add(i);
        }
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) selected.add(n);
    }
  }
  return Array.from(selected).sort((a, b) => a - b);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[/\\:?*"<>|]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  checkFFmpeg();

  const selectedIds = parseStoryboardSelection(storyboardInput);
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestPath = path.resolve(ROOT_DIR, "test-results", "video-manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      fs.unlinkSync(manifestPath);
    } catch {
      // ignore
    }
  }

  console.log("\n=======================================================");
  console.log("       SuiteMail Storyboard MP4 Recorder");
  console.log("=======================================================");
  console.log(`Storyboards   : ${selectedIds ? selectedIds.join(", ") : "All (1 - 20)"}`);
  console.log(`Resolution    : ${videoWidth}x${videoHeight}`);
  console.log(`SlowMo delay  : ${slowMo}ms`);
  console.log(`Output folder : ${outputDir}`);
  console.log(`Keep raw webm : ${Boolean(keepRaw)}`);
  console.log("=======================================================\n");

  // Construct Playwright arguments
  const playwrightArgs = [
    "playwright",
    "test",
    "--config=playwright.video.config.ts",
  ];

  if (selectedIds && selectedIds.length > 0) {
    const pattern = `\\b(${selectedIds.join("|")})\\. `;
    playwrightArgs.push("-g", `"${pattern}"`);
  }

  const env = {
    ...process.env,
    SLOW_MO: String(slowMo),
    VIDEO_WIDTH: String(videoWidth),
    VIDEO_HEIGHT: String(videoHeight),
  };

  console.log("▶ Running Playwright storyboard tests with video recording...\n");
  const result = spawnSync("npx", playwrightArgs, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env,
    shell: true,
  });

  if (!fs.existsSync(manifestPath)) {
    console.error(`\n[ERROR] Video manifest was not generated at: ${manifestPath}`);
    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
    process.exit(1);
  }

  const manifestData = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifestData.length === 0) {
    console.warn("\n[WARN] No storyboard video recordings found in manifest.");
    process.exit(0);
  }

  console.log(`\n▶ Converting ${manifestData.length} recording(s) to universal H.264 MP4...\n`);

  const summary = [];

  for (const item of manifestData) {
    const titleMatch = item.title.match(/^(\d+)\.\s*([^:]+)/);
    const num = titleMatch ? parseInt(titleMatch[1], 10) : 0;
    const rawName = titleMatch ? titleMatch[2].trim() : item.title;
    const numPrefix = String(num).padStart(2, "0");
    const slug = slugify(rawName);

    const mp4Filename = `storyboard-${numPrefix}-${slug}.mp4`;
    const targetMp4Path = path.resolve(outputDir, mp4Filename);

    if (!fs.existsSync(item.videoPath)) {
      console.warn(`[WARN] Video file not found: ${item.videoPath}`);
      continue;
    }

    process.stdout.write(`  Encoding Storyboard #${numPrefix} (${rawName})... `);

    try {
      // FFmpeg command: High-compatibility H.264 with YUV420P & FastStart
      execSync(
        `ffmpeg -y -i "${item.videoPath}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart "${targetMp4Path}"`,
        { stdio: "ignore" }
      );

      // Extract keyframe snapshots (1 frame per second) for visual UX analysis
      const framesDir = path.resolve(outputDir, "frames", `storyboard-${numPrefix}`);
      fs.mkdirSync(framesDir, { recursive: true });
      try {
        execSync(`ffmpeg -y -i "${targetMp4Path}" -vf "fps=1" "${path.resolve(framesDir, "frame_%03d.png")}"`, {
          stdio: "ignore",
        });
      } catch {
        // frame extraction is optional
      }

      const stats = fs.statSync(targetMp4Path);
      process.stdout.write(`✓ Done (${formatBytes(stats.size)})\n`);

      summary.push({
        num: numPrefix,
        name: rawName,
        status: item.status,
        duration: formatDuration(item.duration),
        size: formatBytes(stats.size),
        file: mp4Filename,
        fullPath: targetMp4Path,
      });

      if (!keepRaw) {
        try {
          fs.unlinkSync(item.videoPath);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      process.stdout.write(`✗ Failed\n`);
      console.error(`    Error encoding ${item.videoPath}: ${err.message}`);
    }
  }

  console.log("\n=========================================================================================");
  console.log("                                RECORDING SUMMARY");
  console.log("=========================================================================================");
  console.log(
    ` ${"#".padEnd(4)} | ${"Storyboard Name".padEnd(36)} | ${"Status".padEnd(8)} | ${"Duration".padEnd(8)} | ${"Size".padEnd(9)} | Filename`
  );
  console.log("-".repeat(89));

  for (const row of summary) {
    console.log(
      ` ${row.num.padEnd(4)} | ${row.name.padEnd(36)} | ${row.status.toUpperCase().padEnd(8)} | ${row.duration.padEnd(8)} | ${row.size.padEnd(9)} | ${row.file}`
    );
  }
  console.log("=========================================================================================");
  console.log(`\nAll MP4 recordings saved to: ${outputDir}\n`);

  if (result.status !== 0) {
    console.warn(`[NOTE] Some test assertions failed during execution (exit code: ${result.status}).`);
    process.exit(result.status);
  }
}

main().catch((err) => {
  console.error("[FATAL ERROR]", err);
  process.exit(1);
});
