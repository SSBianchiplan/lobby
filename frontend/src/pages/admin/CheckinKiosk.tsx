import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import jsQR from "jsqr";
import { api, ApiError, type Reservation } from "../../api";
import { Logo } from "../../components/Layout";
import { coachLabel, firstName, isoDay, money, parseCheckinCode, parseCoachToken, parseStudentToken, STATUS_LABEL } from "../../format";

// BarcodeDetector (Chrome/Android) ainda não está nos tipos do TypeScript.
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global { interface Window { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } } }

type Result = { kind: "ok" | "warn" | "error"; title: string; detail: string; r?: Reservation; sub?: string };
const REPEAT_MS = 6000;   // o mesmo QR parado na frente da câmera não repete o check-in
const SHOW_MS = 5000;     // tempo do cartão de resultado na tela

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220; o.type = "sine"; g.gain.value = 0.15;
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.15 : 0.4));
    if (ok) { const o2 = ctx.createOscillator(); o2.frequency.value = 1320; o2.connect(g); o2.start(ctx.currentTime + 0.17); o2.stop(ctx.currentTime + 0.32); }
  } catch { /* sem áudio */ }
  navigator.vibrate?.(ok ? 80 : [60, 60, 60]);
}

/** Recepção: lê o QR da reserva pela câmera (tablet) e faz o check-in sozinho. */
export default function CheckinKiosk() {
  const qc = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busy = useRef(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState("");
  const [engine, setEngine] = useState("");
  const today = isoDay(new Date());
  const schedule = useQuery({
    queryKey: ["admin", "schedule", today], refetchInterval: 20_000,
    queryFn: () => api<{ reservations: Reservation[] }>(`/api/admin/schedule?date=${today}`),
  });

  const checkin = useCallback(async (raw: string) => {
    // QR do professor → registra a chegada e inicia a aula dele
    const coachToken = parseCoachToken(raw);
    if (coachToken) {
      const now = Date.now();
      if (busy.current || (last.current.code === coachToken && now - last.current.at < REPEAT_MS)) return;
      busy.current = true; last.current = { code: coachToken, at: now };
      try {
        const r = await api<{ coach: { name: string }; session: { name: string; court_name: string; starts_at: string; ends_at: string; present: number; expected: number }; already: boolean }>(
          "/api/admin/classes/coach-checkin", { method: "POST", json: { token: coachToken } });
        const t = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        setResult({
          kind: r.already ? "warn" : "ok", title: r.already ? "Aula já iniciada" : `Aula iniciada · ${coachLabel(firstName(r.coach.name))}`,
          detail: `${r.session.name} · ${r.session.court_name} · ${t(r.session.starts_at)}–${t(r.session.ends_at)}`,
          sub: `${r.session.present} de ${r.session.expected} aluno(s) já chegaram`,
        });
        beep(!r.already);
        qc.invalidateQueries({ queryKey: ["admin"] });
      } catch (e) {
        setResult({ kind: e instanceof ApiError && e.status === 404 ? "error" : "warn", title: "Professor", detail: e instanceof ApiError ? e.message : "Falha de conexão." });
        beep(false);
      } finally { busy.current = false; }
      return;
    }
    // QR pessoal do aluno → presença na aula de agora
    const token = parseStudentToken(raw);
    if (token) {
      const now = Date.now();
      if (busy.current || (last.current.code === token && now - last.current.at < REPEAT_MS)) return;
      busy.current = true; last.current = { code: token, at: now };
      try {
        const r = await api<{ user: { name: string }; session: { name: string; court_name: string; coach_name: string; starts_at: string; ends_at: string }; already: boolean; open_cents: number }>(
          "/api/admin/classes/checkin", { method: "POST", json: { token } });
        const t = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        setResult({
          kind: r.already ? "warn" : "ok", title: r.already ? `${r.user.name.split(" ")[0]} já está na aula` : `Boa aula, ${r.user.name.split(" ")[0]}!`,
          detail: `${r.session.name} · ${r.session.court_name} · ${t(r.session.starts_at)}–${t(r.session.ends_at)} · ${coachLabel(r.session.coach_name)}`,
          sub: r.open_cents > 0 ? `Mensalidade em aberto: ${money(r.open_cents)}` : undefined,
        });
        beep(!r.already);
        qc.invalidateQueries({ queryKey: ["admin"] });
      } catch (e) {
        setResult({ kind: e instanceof ApiError && e.status === 404 ? "error" : "warn", title: "Aula", detail: e instanceof ApiError ? e.message : "Falha de conexão." });
        beep(false);
      } finally { busy.current = false; }
      return;
    }
    const code = parseCheckinCode(raw);
    if (!code) { setResult({ kind: "error", title: "QR não reconhecido", detail: "Esse QR não é de uma reserva, aluno ou professor do Padel Lobby." }); beep(false); return; }
    const now = Date.now();
    if (busy.current || (last.current.code === code && now - last.current.at < REPEAT_MS)) return;
    busy.current = true; last.current = { code, at: now };
    try {
      const r = await api<Reservation>("/api/admin/checkin", { method: "POST", json: { code } });
      setResult({ kind: "ok", title: `Bem-vindo, ${r.owner?.name?.split(" ")[0] ?? "jogador"}!`, detail: `${r.court.name} · ${r.start}–${r.end}`, r });
      beep(true);
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Falha de conexão.";
      const r = await api<Reservation>(`/api/reservations/${code}`).catch(() => undefined);
      const done = /já realizado/i.test(msg);
      setResult({ kind: done ? "warn" : e instanceof ApiError && e.status === 404 ? "error" : "warn", title: done ? "Check-in já feito" : code, detail: msg, r });
      beep(done);
    } finally {
      busy.current = false;
    }
  }, [qc]);

  // câmera
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: camId ? { deviceId: { exact: camId } } : { facingMode: { ideal: "environment" } }, audio: false });
        if (stop) return;
        const v = video.current!;
        v.srcObject = stream; await v.play();
        setCamError(null);
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        setCams(devices);
        const native = window.BarcodeDetector && (await window.BarcodeDetector.getSupportedFormats?.())?.includes("qr_code")
          ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
        setEngine(native ? "leitor nativo" : "jsQR");
        const scan = async () => {
          if (stop) return;
          if (!busy.current && v.readyState >= 2) {
            let text: string | null = null;
            if (native) {
              text = (await native.detect(v).catch(() => []))[0]?.rawValue ?? null;
            } else {
              const c = canvas.current!; const w = 640; const h = Math.round((v.videoHeight / v.videoWidth) * w) || 480;
              c.width = w; c.height = h;
              const ctx = c.getContext("2d", { willReadFrequently: true })!;
              ctx.drawImage(v, 0, 0, w, h);
              text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
            if (text) await checkin(text);
          }
          timer = window.setTimeout(scan, 250);
        };
        scan();
      } catch (e) {
        setCamError(e instanceof DOMException && e.name === "NotAllowedError"
          ? "Permita o acesso à câmera nas configurações do navegador para ler os QR codes."
          : "Câmera indisponível neste aparelho. Use o campo de código abaixo.");
      }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [camId, checkin]);

  // tela do tablet sempre acesa
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const req = () => (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<typeof lock> } }).wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    req();
    const onVis = () => { if (document.visibilityState === "visible") req(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); lock?.release().catch(() => {}); };
  }, []);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [result]);

  const arrivals = (schedule.data?.reservations ?? []).filter((r) => ["confirmed", "checked_in", "pending"].includes(r.status) && new Date(r.ends_at).getTime() > Date.now());

  return (
    <div className="kiosk">
      <header className="kiosk-head">
        <Logo height={44} />
        <h1 className="italic-title">Check-in <span className="accent">recepção</span></h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {cams.length > 1 && (
            <select className="select" style={{ height: 44, width: 180 }} value={camId ?? ""} onChange={(e) => setCamId(e.target.value || null)} aria-label="Câmera">
              <option value="">Câmera traseira</option>
              {cams.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Câmera ${i + 1}`}</option>)}
            </select>
          )}
          <button className="btn btn-outline btn-sm" style={{ height: 44 }} onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})}>Tela cheia</button>
          <Link className="btn btn-outline btn-sm" style={{ height: 44 }} to="/admin/agenda">Sair</Link>
        </div>
      </header>

      <div className="kiosk-main">
        <section className="kiosk-cam" aria-label="Leitor de QR code">
          <video ref={video} playsInline muted aria-hidden="true" />
          <canvas ref={canvas} hidden />
          {!camError && <div className="kiosk-frame" aria-hidden="true"><i /><i /><i /><i /></div>}
          {camError && <p className="kiosk-camerr" role="alert">{camError}</p>}
          {result && (
            <div className={`kiosk-result ${result.kind}`} role="status" aria-live="assertive">
              <p className="kiosk-result-icon" aria-hidden="true">{result.kind === "ok" ? "✓" : result.kind === "warn" ? "!" : "✕"}</p>
              <p className="kiosk-result-title">{result.title}</p>
              <p className="kiosk-result-detail">{result.detail}</p>
              {result.sub && <p className="kiosk-result-sub">{result.sub}</p>}
              {result.r && <p className="kiosk-result-sub">{result.r.code} · {result.r.players.map((p) => p.name).join(", ")}{result.r.payment_status === "onsite" ? " · pagamento a receber" : ""}</p>}
            </div>
          )}
          {!result && !camError && <p className="kiosk-hint">Aponte o QR da reserva, do aluno ou do professor{engine && <small> · {engine}</small>}</p>}
        </section>

        <aside className="kiosk-side">
          <form className="card card-pad" style={{ boxShadow: "none", display: "flex", gap: 8, alignItems: "flex-end" }}
            onSubmit={(e) => { e.preventDefault(); last.current = { code: "", at: 0 }; checkin(manual); setManual(""); }}>
            <label className="field" style={{ flex: 1 }}>OU DIGITE O CÓDIGO
              <input className="input" placeholder="PL-XXXXX" value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} autoComplete="off" />
            </label>
            <button className="btn btn-primary" style={{ height: 50 }} disabled={!manual.trim()}>OK</button>
          </form>
          <section className="card card-pad" style={{ boxShadow: "none", flex: 1, minHeight: 0, overflowY: "auto" }}>
            <h2 className="italic-title" style={{ fontSize: 18 }}>Chegadas de hoje</h2>
            {!arrivals.length ? <p className="empty">Ninguém mais previsto hoje.</p> : (
              <ul className="kiosk-list">
                {arrivals.map((r) => (
                  <li key={r.code} className={r.status === "checked_in" ? "in" : ""}>
                    <span className="kiosk-time">{r.start}</span>
                    <span style={{ flex: 1, minWidth: 0 }}><strong>{r.owner?.name}</strong><br /><small className="muted">{r.court.name} · {r.code}</small></span>
                    {r.status === "checked_in" ? <span className={`badge ${STATUS_LABEL.checked_in!.cls}`}>Chegou</span>
                      : r.status === "confirmed" ? <button className="btn btn-dark btn-sm" onClick={() => { last.current = { code: "", at: 0 }; checkin(r.code); }}>Check-in</button>
                      : <span className={`badge ${STATUS_LABEL[r.status]!.cls}`}>{STATUS_LABEL[r.status]!.text}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
