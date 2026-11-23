type Color = [number, number, number, number];

function parseColor(value: string): Color | null {
  const match = value.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 1)];
}

function css([r, g, b, a]: Color): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function brightness([r, g, b]: Color): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

// Change lightness while keeping the hue and saturation of sender colors.
function lightness(color: Color, target: number): Color {
  const [r, g, b, a] = color;
  const low = Math.min(r, g, b) / 255;
  const high = Math.max(r, g, b) / 255;
  const current = (low + high) / 2;
  if (high === low) return [target * 255, target * 255, target * 255, a];
  const saturation = (high - low) / (1 - Math.abs(2 * current - 1));
  const chroma = (1 - Math.abs(2 * target - 1)) * saturation;
  const offset = target - chroma / 2;
  const channel = (value: number) => ((value / 255 - low) / (high - low) * chroma + offset) * 255;
  return [channel(r), channel(g), channel(b), a];
}

function background(color: Color): Color {
  // Like Chromium's selective darkening, leave dark and saturated surfaces alone.
  if (brightness(color) <= 205) return color;
  const l = (Math.min(...color.slice(0, 3)) + Math.max(...color.slice(0, 3))) / 510;
  return lightness(color, 0.12 + (1 - l) * 0.6);
}

function composite(color: Color, backdrop: Color): Color {
  const alpha = color[3];
  return [
    color[0] * alpha + backdrop[0] * (1 - alpha),
    color[1] * alpha + backdrop[1] * (1 - alpha),
    color[2] * alpha + backdrop[2] * (1 - alpha),
    1,
  ];
}

function luminance(color: Color): number {
  const linear = color.slice(0, 3).map((v) => {
    const channel = v / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function foreground(color: Color, backdrop: Color): Color {
  if (color[3] === 0) return color;
  const bg = luminance(backdrop);
  const contrast = (candidate: Color) => {
    const fg = luminance(composite(candidate, backdrop));
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  };
  if (contrast(color) >= 4.5) return color;
  const lighten = bg < 0.179;
  if (lighten) {
    const l = (Math.min(...color.slice(0, 3)) + Math.max(...color.slice(0, 3))) / 510;
    const inverted = lightness(color, Math.min(0.9, Math.max(0.6, 1 - l)));
    if (contrast(inverted) >= 4.5) return inverted;
  }
  // Preserve hue instead of turning every link, heading, and accent white.
  for (let step = 1; step <= 20; step++) {
    const target = lighten ? 0.5 + step * 0.025 : 0.5 - step * 0.025;
    const candidate = lightness(color, target);
    if (contrast(candidate) >= 4.5) return candidate;
  }
  return lightness(color, lighten ? 1 : 0);
}

/** Read metadata before sanitization removes the email's head. Never render it. */
export function emailDisablesDarkMode(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("meta[name]")).some((meta) =>
    meta.getAttribute("name")?.toLowerCase() === "color-scheme"
    && /^\s*(?:light\s+only|only\s+light)\s*$/i.test(meta.getAttribute("content") ?? ""),
  );
}

/**
 * Gmail Android-style selective darkening, applied by the parent to the sandboxed
 * document. No global invert filter: photos, logos, and image pixels stay intact.
 * This approximates Gmail; its rendering settings vary by platform and release.
 */
export function applyEmailDarkMode(doc: Document): void {
  const view = doc.defaultView;
  if (!view || !doc.body) return;

  const elements = [doc.body, ...doc.body.querySelectorAll<HTMLElement>("*")];
  // Snapshot before writing: inherited colors must not be transformed twice.
  const snapshots = elements.map((element) => {
    const style = view.getComputedStyle(element);
    return {
      element,
      color: style.color,
      background: style.backgroundColor,
      image: style.backgroundImage,
      borders: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
    };
  });
  const backdrops = new Map<Element, Color>();
  const imageBackdrops = new Map<Element, boolean>();
  for (const snapshot of snapshots) {
    const { element } = snapshot;
    // SVG is an image too. Do not recolor its component shapes.
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    const parent = element.parentElement;
    const inherited = (parent && backdrops.get(parent)) || [32, 33, 36, 1] as Color;
    const originalBackground = parseColor(snapshot.background);
    const hasImage = /url\(/i.test(snapshot.image)
      || (originalBackground?.[3] !== 1 && !!parent && !!imageBackdrops.get(parent));
    imageBackdrops.set(element, hasImage);
    const transformedBackground = originalBackground && background(originalBackground);
    const backdrop = transformedBackground ? composite(transformedBackground, inherited) : inherited;
    backdrops.set(element, backdrop);
    const set = (property: string, value: string) => element.style.setProperty(property, value, "important");
    if (transformedBackground) set("background-color", css(transformedBackground));
    // Gradients are CSS colors; raster and SVG background image URLs are untouched.
    if (!/url\(/i.test(snapshot.image) && /gradient\(/i.test(snapshot.image)) {
      set("background-image", snapshot.image.replace(/rgba?\([^)]*\)/g, (value) => {
        const color = parseColor(value);
        return color ? css(background(color)) : value;
      }));
    }
    const text = parseColor(snapshot.color);
    // An image's brightness cannot be inferred from its surrounding CSS colors.
    if (text) set("color", hasImage ? snapshot.color : css(foreground(text, backdrop)));
    snapshot.borders.forEach((value, index) => {
      const color = parseColor(value);
      if (color) set(`border-${["top", "right", "bottom", "left"][index]}-color`, css(background(color)));
    });
  }
  doc.documentElement.style.colorScheme = "dark";
}
