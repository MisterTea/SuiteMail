import type { Reporter, TestCase, TestResult, FullResult } from "@playwright/test/reporter";
import fs from "fs";
import path from "path";

export default class VideoReporter implements Reporter {
  private records: Array<{ title: string; videoPath: string; status: string; duration: number }> = [];
  private outputFile: string;

  constructor(options?: { outputFile?: string }) {
    this.outputFile = options?.outputFile || path.join(process.cwd(), "test-results", "video-manifest.json");
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const videoAttachment = result.attachments.find((a) => a.name === "video");
    if (videoAttachment && videoAttachment.path) {
      this.records.push({
        title: test.title,
        videoPath: videoAttachment.path,
        status: result.status,
        duration: result.duration,
      });
    }
  }

  async onEnd(_result: FullResult) {
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, JSON.stringify(this.records, null, 2), "utf8");
  }
}
