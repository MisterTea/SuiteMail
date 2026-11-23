import { applyEmailDarkMode, emailDisablesDarkMode } from "./emailDarkMode";

function renderEmail(html: string): Document {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<html><head></head><body style="background: white; color: black">${html}</body></html>`);
  doc.close();
  return doc;
}

afterEach(() => document.body.replaceChildren());

describe("email dark mode", () => {
  it("darkens legacy table backgrounds and inline important colors", () => {
    const doc = renderEmail('<table bgcolor="#ffffff"><tr><td style="color: #000 !important; background: #fff !important">Hello</td></tr></table>');
    applyEmailDarkMode(doc);
    const cell = doc.querySelector("td")!;
    expect(cell.style.color).not.toBe("rgb(0, 0, 0)");
    expect(cell.style.backgroundColor).not.toBe("rgb(255, 255, 255)");
    expect(cell.style.getPropertyPriority("color")).toBe("important");
  });

  it("preserves dark panels and white text, images, and layout", () => {
    const doc = renderEmail('<div style="background-color: rgb(17, 34, 51); color: white; padding: 20px"><img src="cid:logo" style="width: 100px"><span style="color: white">Hello</span></div>');
    applyEmailDarkMode(doc);
    expect(doc.querySelector("div")!.style.backgroundColor).toBe("rgb(17, 34, 51)");
    expect(doc.querySelector("span")!.style.color).toBe("rgb(255, 255, 255)");
    expect(doc.querySelector("div")!.style.padding).toBe("20px");
    expect(doc.querySelector("img")!.getAttribute("src")).toBe("cid:logo");
    expect(doc.querySelector("img")!.style.filter).toBe("");
  });

  it("keeps transparent text hidden and inherited foregrounds readable", () => {
    const doc = renderEmail('<div style="color: black"><span>Nested</span><span style="color: transparent">Hidden</span></div>');
    applyEmailDarkMode(doc);
    const [visible, hidden] = doc.querySelectorAll("span");
    expect(visible!.style.color).toBe(doc.querySelector("div")!.style.color);
    expect(hidden!.style.color).toBe("rgba(0, 0, 0, 0)");
  });

  it("does not alter image background URLs or text over those images", () => {
    const doc = renderEmail('<div style="background-image: url(https://example.com/hero.png); color: black"><span>Caption</span></div>');
    const image = doc.querySelector("div")!.style.backgroundImage;
    applyEmailDarkMode(doc);
    expect(doc.querySelector("div")!.style.backgroundImage).toBe(image);
    expect(doc.querySelector("span")!.style.color).toBe("rgb(0, 0, 0)");
  });

  it("darkens opaque panels placed over background images", () => {
    const doc = renderEmail('<div style="background-image: url(https://example.com/hero.png)"><p style="background-color: white; color: black">Panel</p></div>');
    applyEmailDarkMode(doc);
    expect(doc.querySelector("p")!.style.color).not.toBe("rgb(0, 0, 0)");
  });

  it("recognizes only an explicit light-only metadata opt-out", () => {
    expect(emailDisablesDarkMode('<meta NAME="COLOR-SCHEME" content="light only">')).toBe(true);
    expect(emailDisablesDarkMode('<meta name="color-scheme" content="only light">')).toBe(true);
    expect(emailDisablesDarkMode('<meta name="color-scheme" content="light dark">')).toBe(false);
    expect(emailDisablesDarkMode('<p>light only</p>')).toBe(false);
  });
});
