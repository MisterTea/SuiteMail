/** Keep native WebView content and overlays inside the visible keyboard viewport. */
export function installAndroidViewport(): void {
  const root = document.documentElement;
  let largestHeight = window.innerHeight;
  const update = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    largestHeight = Math.max(largestHeight, window.innerHeight);
    root.style.setProperty("--android-viewport-height", `${height}px`);
    root.dataset.androidKeyboard = largestHeight - height > 140 ? "open" : "closed";
  };
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
  window.addEventListener("orientationchange", () => { largestHeight = window.innerHeight; update(); });
  update();
}
