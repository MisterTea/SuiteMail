import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

/** Native phone layouts can change without changing the desktop experience. */
export function useAndroidMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    Capacitor.getPlatform() === "android" && window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
