import { useState } from "react";
import QRCode from "qrcode";

export type TicketData = {
  kind: string;            // "CHECK-IN DA QUADRA", "CHECK-IN DO ALUNO"…
  title: string;           // "Quadra 2"
  subtitle: string;        // "Ter 27/10 · 14:00–15:00"
  status?: string;         // "CONFIRMADA"
  rows: [string, string][];
  qr: string;
  code: string;
  footer: string;
  filename: string;
};

const W = 1080, PAD = 72, R = 48;
const FONT = '"Montserrat", Arial, sans-serif';

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(" "); const lines: string[] = []; let line = "";
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}

/** Corta com reticências o que não cabe numa linha. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Desenha o cartão de check-in (estilo bilhete com picote) e devolve PNG. */
export async function renderTicket(t: TicketData): Promise<Blob> {
  await Promise.all(["900 italic 64px", "800 30px", "600 30px", "700 26px"].map((f) => document.fonts?.load(`${f} Montserrat`).catch(() => null)));
  const rowsH = t.rows.length * 92;
  const H = 360 + 80 + rowsH + 120 + 640 + 200;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#F7F5F5"; ctx.fillRect(0, 0, W, H);

  // corpo do bilhete com cantos arredondados e recortes (meias-luas) na linha do picote
  const x = 40, y = 40, w = W - 80, h = H - 80, cutY = 360 + 80 + rowsH + 60;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + R, y); ctx.arcTo(x + w, y, x + w, y + h, R); ctx.lineTo(x + w, cutY - 36);
  ctx.arc(x + w, cutY, 36, -Math.PI / 2, Math.PI / 2, true);
  ctx.arcTo(x + w, y + h, x, y + h, R); ctx.arcTo(x, y + h, x, y, R); ctx.lineTo(x, cutY + 36);
  ctx.arc(x, cutY, 36, Math.PI / 2, -Math.PI / 2, true);
  ctx.arcTo(x, y, x + w, y, R); ctx.closePath();
  ctx.shadowColor = "rgba(43,43,43,0.18)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#FFFFFF"; ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();

  // cabeçalho vermelho (gradiente da marca) com bola decorativa
  const g = ctx.createLinearGradient(0, y, 0, y + 360);
  g.addColorStop(0, "#E8402A"); g.addColorStop(0.55, "#C8102E"); g.addColorStop(1, "#8E0F1B");
  ctx.fillStyle = g; ctx.fillRect(x, y, w, 360);
  ctx.fillStyle = "#F2A516"; ctx.beginPath(); ctx.arc(x + w - 30, y + 40, 150, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,226,166,0.85)"; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(x + w - 210, y + 40, 150, -0.6, 0.9); ctx.stroke();

  // logo num selo branco
  const logo = await loadImage("/logo.png").catch(() => null);
  ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.roundRect(x + PAD - 20, y + 44, 300, 120, 24); ctx.fill();
  if (logo) { const lh = 92, lw = (logo.width / logo.height) * lh; ctx.drawImage(logo, x + PAD - 20 + (300 - lw) / 2, y + 58, lw, lh); }

  ctx.fillStyle = "#FFFFFF"; ctx.font = `800 26px ${FONT}`; ctx.fillText(t.kind, x + PAD, y + 214);
  ctx.font = `900 italic 72px ${FONT}`; ctx.fillText(t.title, x + PAD, y + 286);
  ctx.font = `600 32px ${FONT}`; ctx.fillText(t.subtitle, x + PAD, y + 334);
  if (t.status) {
    ctx.font = `800 24px ${FONT}`; const sw = ctx.measureText(t.status).width + 40;
    ctx.fillStyle = "#F2A516"; ctx.beginPath(); ctx.roundRect(x + w - PAD - sw, y + 196, sw, 46, 23); ctx.fill();
    ctx.fillStyle = "#2B2B2B"; ctx.fillText(t.status, x + w - PAD - sw + 20, y + 228);
  }

  // dados
  let ry = y + 360 + 80;
  for (const [label, value] of t.rows) {
    ctx.fillStyle = "#6E6E6E"; ctx.font = `800 22px ${FONT}`; ctx.fillText(label.toUpperCase(), x + PAD, ry);
    ctx.fillStyle = "#2B2B2B"; ctx.font = `700 32px ${FONT}`;
    ctx.fillText(fit(ctx, value, w - PAD * 2), x + PAD, ry + 40);
    ry += 92;
  }

  // picote
  ctx.setLineDash([18, 14]); ctx.strokeStyle = "#D9D2D2"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x + 56, cutY); ctx.lineTo(x + w - 56, cutY); ctx.stroke(); ctx.setLineDash([]);

  // QR
  const qrUrl = await QRCode.toDataURL(t.qr, { margin: 1, width: 560, errorCorrectionLevel: "M", color: { dark: "#2B2B2B", light: "#FFFFFF" } });
  const qr = await loadImage(qrUrl);
  const qy = cutY + 60;
  ctx.drawImage(qr, (W - 560) / 2, qy, 560, 560);
  ctx.fillStyle = "#2B2B2B"; ctx.font = `900 italic 48px ${FONT}`; ctx.textAlign = "center";
  ctx.fillText(t.code, W / 2, qy + 620);
  ctx.fillStyle = "#6E6E6E"; ctx.font = `600 26px ${FONT}`;
  wrap(ctx, t.footer, w - PAD * 2).slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, qy + 670 + i * 36));
  ctx.restore();

  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Botões "Baixar" e "Compartilhar" (menu do aparelho → WhatsApp etc.). Sem compartilhamento de arquivo, baixa a imagem. */
/** Gera o cartão de check-in e abre o menu de compartilhar do aparelho (WhatsApp etc.); sem esse recurso, baixa a imagem. */
export async function shareTicket(data: TicketData, shareText: string, share: boolean, onToast: (m: string) => void) {
  try {
    const blob = await renderTicket(data);
    const file = new File([blob], data.filename, { type: "image/png" });
    if (share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: data.title, text: shareText }).catch((e) => { if (e?.name !== "AbortError") throw e; });
    } else {
      download(blob, data.filename);
      onToast(share ? "Imagem salva. Agora é só anexar no WhatsApp." : "Imagem salva");
    }
  } catch {
    onToast("Não foi possível gerar a imagem.");
  }
}

export function TicketActions({ data, shareText, onToast, compact = false }: { data: TicketData; shareText: string; onToast: (m: string) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async (share: boolean) => { setBusy(true); await shareTicket(data, shareText, share, onToast); setBusy(false); };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
      <button type="button" className={`btn btn-soft${compact ? " btn-sm" : ""}`} disabled={busy} onClick={() => run(true)}>Compartilhar check-in</button>
      <button type="button" className={`btn btn-outline${compact ? " btn-sm" : ""}`} disabled={busy} onClick={() => run(false)}>Baixar imagem</button>
    </div>
  );
}
