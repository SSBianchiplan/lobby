import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError, type Reservation } from "../../api";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { dayLabel, isoDay, money, PAY_LABEL, STATUS_LABEL } from "../../format";

export const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const hours = (min: number) => `${(min / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;

export const CHANNEL_LABEL: Record<string, string> = {
  pix_online: "Pix online", cartao_online: "Cartão online", dinheiro: "Dinheiro",
  pix_balcao: "Pix no balcão", debito: "Débito", credito: "Crédito",
};
export const COUNTER_CHANNELS = ["dinheiro", "pix_balcao", "debito", "credito"] as const;
export const PAY_STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: "Aguardando Pix", cls: "badge-cream" },
  paid: { text: "Pago", cls: "badge-ok" },
  onsite: { text: "A receber", cls: "badge-red" },
  refunded: { text: "Estornado", cls: "badge-off" },
  void: { text: "Sem cobrança", cls: "badge-off" },
};
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const WD_SHORT = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Download autenticado (o token vai no cabeçalho, então não dá para usar um <a href> simples). */
export async function downloadCsv(path: string, filename: string) {
  const csv = await api<string>(path);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Período ────────────────────────────────────────────────────────────────

export type Period = { start: string; end: string };
const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); return isoDay(new Date(y, m - 1, d + n)); };
const today = () => isoDay(new Date());

const PRESETS: { key: string; label: string; make: () => Period }[] = [
  { key: "today", label: "Hoje", make: () => ({ start: today(), end: addDays(today(), 1) }) },
  { key: "next7", label: "Próx. 7 dias", make: () => ({ start: today(), end: addDays(today(), 7) }) },
  { key: "last7", label: "Últ. 7 dias", make: () => ({ start: addDays(today(), -6), end: addDays(today(), 1) }) },
  { key: "month", label: "Este mês", make: () => { const d = new Date(); return { start: isoDay(new Date(d.getFullYear(), d.getMonth(), 1)), end: isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 1)) }; } },
  { key: "prev", label: "Mês passado", make: () => { const d = new Date(); return { start: isoDay(new Date(d.getFullYear(), d.getMonth() - 1, 1)), end: isoDay(new Date(d.getFullYear(), d.getMonth(), 1)) }; } },
];

export function usePeriod(initial = "month") {
  const [preset, setPreset] = useState(initial);
  const [period, setPeriod] = useState<Period>(() => PRESETS.find((p) => p.key === initial)!.make());
  return { preset, period, choose: (k: string) => { setPreset(k); setPeriod(PRESETS.find((p) => p.key === k)!.make()); }, custom: (p: Period) => { setPreset("custom"); setPeriod(p); } };
}

/** Datas na tela são inclusivas; a API usa [início, fim). */
export function PeriodPicker({ value }: { value: ReturnType<typeof usePeriod> }) {
  const { preset, period } = value;
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }} className="no-print">
      <div className="chips" role="group" aria-label="Período" style={{ flexWrap: "wrap" }}>
        {PRESETS.map((p) => <button key={p.key} aria-pressed={preset === p.key} onClick={() => value.choose(p.key)}>{p.label}</button>)}
      </div>
      <label className="field" style={{ width: 160 }}>DE
        <input className="input" type="date" value={period.start}
          onChange={(e) => e.target.value && value.custom({ start: e.target.value, end: period.end > e.target.value ? period.end : addDays(e.target.value, 1) })} />
      </label>
      <label className="field" style={{ width: 160 }}>ATÉ
        <input className="input" type="date" value={addDays(period.end, -1)} min={period.start}
          onChange={(e) => e.target.value && value.custom({ start: period.start, end: addDays(e.target.value, 1) })} />
      </label>
    </div>
  );
}

export const periodLabel = (p: Period) => {
  const last = addDays(p.end, -1);
  return last === p.start ? dayLabel(p.start) : `${dayLabel(p.start)} a ${dayLabel(last)}`;
};

// ── Ações sobre reservas ───────────────────────────────────────────────────

export function useAdminActions(onChange: () => void) {
  const toast = useToast();
  const confirm = useConfirm();
  const err = (e: unknown) => toast(e instanceof ApiError ? e.message : "Falhou.");
  const ok = (m: string) => () => { onChange(); toast(m); };
  const cancel = useMutation({ mutationFn: (code: string) => api(`/api/reservations/${code}/cancel`, { method: "POST", json: { reason: "Cancelada pela administração" } }), onSuccess: ok("Reserva cancelada e estornada"), onError: err });
  const actionsCancel = (code: string, onDone?: () => void) => cancel.mutate(code, { onSuccess: () => onDone?.() });
  return {
    checkin: useMutation({ mutationFn: (code: string) => api<Reservation>("/api/admin/checkin", { method: "POST", json: { code } }), onSuccess: ok("Check-in registrado"), onError: err }),
    receive: useMutation({
      mutationFn: (v: { code: string; channel: string; note?: string }) =>
        api(`/api/admin/reservations/${v.code}/receive`, { method: "POST", json: { channel: v.channel, note: v.note || null } }),
      onSuccess: ok("Recebimento lançado no caixa"), onError: err,
    }),
    cancel,
    /** Confirma e cancela (pela administração o estorno é sempre integral). */
    askCancel: async (r: Reservation, onDone?: () => void) => {
      if (await confirm({ title: `Cancelar ${r.code}?`, message: <>{r.court.name} · {dayLabel(r.date)} {r.start}–{r.end} · {r.owner?.name}.{r.payment_status === "paid" && <> O valor de <strong>{money(r.price_cents)}</strong> será estornado.</>} O cliente é avisado.</>, confirmLabel: "Cancelar reserva", cancelLabel: "Manter", danger: true }))
        actionsCancel(r.code, onDone);
    },
  };
}
export type AdminActions = ReturnType<typeof useAdminActions>;

export function ReceiveButton({ r, actions }: { r: Reservation; actions: AdminActions }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState("dinheiro");
  if (!open) return <button className="btn btn-soft btn-sm" onClick={() => setOpen(true)}>Receber</button>;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select className="select" style={{ height: 36, width: 140, fontSize: 13 }} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Forma de recebimento">
        {COUNTER_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
      </select>
      <button className="btn btn-primary btn-sm" disabled={actions.receive.isPending}
        onClick={() => actions.receive.mutate({ code: r.code, channel }, { onSuccess: () => setOpen(false) })}>{money(r.price_cents)} ✓</button>
      <button className="text-link" onClick={() => setOpen(false)} aria-label="Fechar">✕</button>
    </span>
  );
}

function ReservationRow({ r, actions, showDate }: { r: Reservation; actions: AdminActions; showDate: boolean }) {
  const st = STATUS_LABEL[r.status]!;
  const ps = PAY_STATUS[r.payment_status]!;
  const receivable = (r.payment_status === "onsite" && ["confirmed", "checked_in", "completed"].includes(r.status)) || r.status === "pending";
  return (
    <tr>
      <td className="rt-title" style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{showDate && <div>{dayLabel(r.date)}</div>}{r.start}–{r.end}<span className="hide-desktop" style={{ fontWeight: 600, color: "var(--muted)" }}> · {r.court.name}</span></td>
      <td className="rt-hide-m" style={{ whiteSpace: "nowrap" }}>{r.court.name}</td>
      <td data-label="Cliente"><span>{r.owner?.name}<div className="muted" style={{ fontSize: 12 }}>{r.owner?.phone || r.owner?.email} · {r.players.length} jog.</div></span></td>
      <td data-label="Código"><code style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{r.code}</code></td>
      <td data-label="Valor" style={{ whiteSpace: "nowrap" }}><span>{money(r.price_cents)}<div style={{ fontSize: 12, marginTop: 2 }}><span className="muted">{PAY_LABEL[r.payment_method]} · </span><span className={`badge ${ps.cls}`} style={{ padding: "1px 8px", fontSize: 11 }}>{ps.text}</span></div></span></td>
      <td data-label="Situação"><span className={`badge ${st.cls}`}>{st.text}</span></td>
      <td className="rt-actions" style={{ whiteSpace: "nowrap", textAlign: "right" }}>
        {r.status === "confirmed" && <button className="btn btn-dark btn-sm" onClick={() => actions.checkin.mutate(r.code)}>Check-in</button>}
        {receivable && <ReceiveButton r={r} actions={actions} />}
        {r.can_cancel && <button className="btn btn-outline btn-sm" onClick={() => actions.askCancel(r)}>Cancelar</button>}
      </td>
    </tr>
  );
}

export function ResTable({ items, actions, showDate = false }: { items: Reservation[]; actions: AdminActions; showDate?: boolean }) {
  if (!items.length) return <p className="empty">Nenhuma reserva.</p>;
  return (
    <div className="table-scroll">
      <table className="table rt" style={{ minWidth: 960 }}>
        <thead><tr><th>HORÁRIO</th><th>QUADRA</th><th>CLIENTE</th><th>CÓDIGO</th><th>VALOR</th><th>SITUAÇÃO</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{items.map((r) => <ReservationRow key={r.code} r={r} actions={actions} showDate={showDate} />)}</tbody>
      </table>
    </div>
  );
}

export function Kpi({ label, value, sub, accent, children }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; children?: ReactNode }) {
  return (
    <div className="kpi">
      <p className="label">{label}</p>
      <p className={`value${accent ? " accent" : ""}`}>{value}</p>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </div>
  );
}

export function Panel({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card card-pad" style={{ boxShadow: "none" }}>
      <div className="between" style={{ marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <h2 className="italic-title" style={{ fontSize: 20 }}>{title}</h2>
        {actions && <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}
