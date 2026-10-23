import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "padel.theme";
const BAR = { light: "#C8102E", dark: "#1E1E1E" };

const readPref = (): ThemePref => {
  try { const t = localStorage.getItem(KEY); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; }
};
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme; else root.dataset.theme = pref;
  // barra do navegador/PWA acompanha a escolha manual; em "sistema" cada meta vale para seu media
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = pref === "system" ? (m.media.includes("dark") ? BAR.dark : BAR.light) : BAR[pref];
  });
}

/** Preferência de tema (sistema/claro/escuro), guardada no aparelho, e o tema efetivo agora. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [dark, setDark] = useState(() => (pref === "system" ? systemDark() : pref === "dark"));
  useEffect(() => {
    apply(pref);
    try { pref === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, pref); } catch { /* sem storage */ }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(pref === "system" ? mq.matches : pref === "dark");
    on();
    mq.addEventListener("change", on);
    window.dispatchEvent(new Event("padel-theme"));
    return () => mq.removeEventListener("change", on);
  }, [pref]);
  useEffect(() => {
    const sync = () => setPref(readPref());
    window.addEventListener("padel-theme", sync);
    return () => window.removeEventListener("padel-theme", sync);
  }, []);
  return { pref, setPref, dark };
}

const Sun = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
const Moon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;

/** Botão do cabeçalho: alterna claro/escuro. */
export function ThemeButton() {
  const { dark, setPref } = useTheme();
  return (
    <button type="button" className="icon-btn" onClick={() => setPref(dark ? "light" : "dark")}
      aria-label={dark ? "Usar tema claro" : "Usar tema escuro"} title={dark ? "Tema claro" : "Tema escuro"}>
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

/** Escolha completa (perfil): Sistema / Claro / Escuro. */
export function ThemeChooser() {
  const { pref, setPref } = useTheme();
  return (
    <div className="segmented" role="group" aria-label="Aparência">
      {([["system", "Automático"], ["light", "Claro"], ["dark", "Escuro"]] as const).map(([v, l]) => (
        <button key={v} type="button" aria-pressed={pref === v} onClick={() => setPref(v)}>{l}</button>
      ))}
    </div>
  );
}
