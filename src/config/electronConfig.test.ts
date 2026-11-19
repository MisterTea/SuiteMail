import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

describe("electron configuration", () => {
  it("should configure package.json main entry point to electron/main.js", () => {
    const pkgPath = resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.main).toBe("electron/main.js");
  });

  it("should configure electron-builder.json with valid appId and files", () => {
    const builderPath = resolve(__dirname, "../../electron-builder.json");
    expect(existsSync(builderPath)).toBe(true);
    const builderConfig = JSON.parse(readFileSync(builderPath, "utf-8"));
    expect(builderConfig.appId).toBe("com.suitemail.app");
    expect(builderConfig.files).toContain("electron/**/*");
  });

  it("should verify electron main and preload scripts exist", () => {
    const mainPath = resolve(__dirname, "../../electron/main.js");
    const preloadPath = resolve(__dirname, "../../electron/preload.cjs");
    expect(existsSync(mainPath)).toBe(true);
    expect(existsSync(preloadPath)).toBe(true);
  });
});
