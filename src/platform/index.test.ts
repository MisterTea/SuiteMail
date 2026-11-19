import { describe, it, expect } from "vitest";
import { stripForbiddenRequestHeaders } from "./index";

describe("stripForbiddenRequestHeaders", () => {
  it("drops headers the webview Request constructor refuses", () => {
    const init = stripForbiddenRequestHeaders({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer pi-harness",
        "User-Agent": "OpenAI/JS",
        Host: "localhost",
      },
    });

    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer pi-harness");
    expect(headers.get("user-agent")).toBeNull();
    expect(headers.get("host")).toBeNull();
  });
});
