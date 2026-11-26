import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

const isNativePhone = () => ["android", "ios"].includes(Capacitor.getPlatform());

/** Native phone layouts can change without changing the desktop experience. */
export function useNativePhone(): boolean {
  const [mobile, setMobile] = useState(() =>
    isNativePhone() && window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    if (!isNativePhone()) return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
