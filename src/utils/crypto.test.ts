import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPlatformFs } from "@/test/mocks";

const platformFs = createMockPlatformFs();

describe("crypto", () => {
  beforeEach(() => {
    (window as any).supermail = { fs: platformFs.mock };
    vi.resetModules();
    platformFs.store.clear();
  });

  it("encrypts and decrypts a value roundtrip", async () => {
    const { encryptValue, decryptValue } = await import("./crypto");
    const plaintext = "my-secret-api-key-12345";
    const encrypted = await encryptValue(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(":")).toHaveLength(2);

    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", async () => {
    const { encryptValue } = await import("./crypto");
    const plaintext = "same-value";
    const enc1 = await encryptValue(plaintext);
    const enc2 = await encryptValue(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  it("decryptValue throws on invalid format", async () => {
    const { decryptValue } = await import("./crypto");
    await expect(decryptValue("not-valid")).rejects.toThrow("Invalid encrypted value format");
  });

  it("isEncrypted returns true for encrypted values", async () => {
    const { encryptValue, isEncrypted } = await import("./crypto");
    const encrypted = await encryptValue("test");
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("isEncrypted returns false for plaintext", async () => {
    const { isEncrypted } = await import("./crypto");
    expect(isEncrypted("sk-ant-1234567890abcdef")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("just-a-regular-string")).toBe(false);
  });

  it("handles empty string encryption", async () => {
    const { encryptValue, decryptValue } = await import("./crypto");
    const encrypted = await encryptValue("");
    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles unicode content", async () => {
    const { encryptValue, decryptValue } = await import("./crypto");
    const plaintext = "Hello World! Emoji test";
    const encrypted = await encryptValue(plaintext);
    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("uses FS operations for key storage", async () => {
    const { encryptValue } = await import("./crypto");

    await encryptValue("test");

    expect(platformFs.mock.exists).toHaveBeenCalledWith("suitemail.key");
    expect(platformFs.mock.writeTextFile).toHaveBeenCalledWith(
      "suitemail.key",
      expect.any(String),
    );
  });

  it("reads existing key from file", async () => {
    // Pre-seed a key in the mock store
    const mockKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
    platformFs.store.set("suitemail.key", mockKey);

    const { encryptValue, decryptValue } = await import("./crypto");
    const encrypted = await encryptValue("round-trip-test");

    expect(platformFs.mock.readTextFile).toHaveBeenCalledWith("suitemail.key");

    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe("round-trip-test");
  });

  it.each(["filesystem", "localStorage"])("decrypts saved data using the legacy key in %s", async (storage) => {
    const storedKeys = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (name: string) => storedKeys.get(name) ?? null,
      setItem: (name: string, value: string) => storedKeys.set(name, value),
      removeItem: (name: string) => storedKeys.delete(name),
    });
    try {
      if (storage === "localStorage") {
        (window as any).supermail = undefined;
      }
      const { encryptValue } = await import("./crypto");
      const encrypted = await encryptValue("saved-before-the-rename");
      if (storage === "filesystem") {
        platformFs.store.set("velo.key", platformFs.store.get("suitemail.key")!);
        platformFs.store.delete("suitemail.key");
      } else {
        localStorage.setItem("velo.key", localStorage.getItem("suitemail.key")!);
        localStorage.removeItem("suitemail.key");
      }
      vi.resetModules();
      const { decryptValue } = await import("./crypto");
      expect(await decryptValue(encrypted)).toBe("saved-before-the-rename");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
