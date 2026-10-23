import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { tokenStore } from "../api";

const PRIVATE = /^\/(admin|recepcao|professor)(\/|$)/;  // telas internas não entram na estatística do site

function id(storage: Storage | undefined, key: string) {
  try {
    let v = storage?.getItem(key);
    if (!v) { v = crypto.randomUUID(); storage?.setItem(key, v); }
    return v;
  } catch { return crypto.randomUUID(); }
}

/** Registra a página vista (anônimo: id aleatório do navegador; o servidor guarda o IP truncado). */
export function Tracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (PRIVATE.test(pathname) || navigator.doNotTrack === "1") return;
    const token = tokenStore.get();
    const body = JSON.stringify({
      path: pathname, referrer: document.referrer || null,
      visitor: id(typeof localStorage === "undefined" ? undefined : localStorage, "padel.vid"),
      session: id(typeof sessionStorage === "undefined" ? undefined : sessionStorage, "padel.sid"),
    });
    fetch("/api/track", { method: "POST", keepalive: true, body,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }).catch(() => {});
  }, [pathname]);
  return null;
}
