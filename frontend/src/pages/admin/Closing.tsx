import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Spinner } from "../../components/Layout";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { dayLabel, isoDay, money } from "../../format";
import { CHANNEL_LABEL, hours, Kpi, Panel, plural } from "./shared";

type Summary = {
  date: string; received_cents: number; refunded_cents: number; net_cents: number; cash_expected_cents: number;
  by_channel: Record<string, { received_cents: number; refunded_cents: number; count: number }>;
  games: { played: number; cancelled: number; no_checkin: number; minutes: number; value_cents: number; open_cents: number; open_count: number };
  by_court: { name: string; bookings: number; minutes: number; value_cents: number }[];
};
type ClosingRow = {
  day: string; received_cents: number; refunded_cents: number; cash_expected_cents: number; cash_counted_cents: number;
  note: string | null; closed_at: string; closed_by_name: string; reopened_at: string | null; reopened_by_name: string | null;
  locked: boolean; history: { closed_at: string; reopened_at: string; reason: string; cash_counted_cents: number; cash_expected_cents: number }[];
};
type Closing = { summary: Summary; closing: ClosingRow | null; drift: { received_cents: number; refunded_cents: number } | null; can_close: boolean };
type Month = { items: ClosingRow[]; pending_days: string[] };

/** "1.234,56" → 123456 */
const parseBRL = (s: string) => {
  const n = Number(s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const fmtDT = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function Diff({ cents }: { cents: number }) {
  if (cents === 0) return <span className="badge badge-ok">Caixa confere</span>;
  return <span className={`badge ${cents > 0 ? "badge-cream" : "badge-red"}`}>{cents > 0 ? "Sobra" : "Falta"} de {money(Math.abs(cents))}</span>;
}

export default function ClosingPage() {
  const [day, setDay] = useState(() => isoDay(new Date()));
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const err = (e: unknown) => toast(e instanceof ApiError ? e.message : "Falhou.");
  const q = useQuery({ queryKey: ["admin", "closing", day], queryFn: () => api<Closing>(`/api/admin/closings/${day}`), refetchInterval: 30_000 });
  const month = day.slice(0, 8) + "01";
  const [y, m] = month.split("-").map(Number);
  const monthEnd = isoDay(new Date(y!, m!, 1));
  const mq = useQuery({ queryKey: ["admin", "closings", month], queryFn: () => api<Month>(`/api/admin/closings?start=${month}&end=${monthEnd}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const close = useMutation({
    mutationFn: () => api(`/api/admin/closings/${day}`, { method: "POST", json: { cash_counted_cents: parseBRL(counted), note: note || null } }),
    onSuccess: () => { refresh(); setCounted(""); setNote(""); toast("Caixa fechado"); }, onError: err,
  });
  const reopen = useMutation({
    mutationFn: () => api(`/api/admin/closings/${day}/reopen`, { method: "POST", json: { reason } }),
    onSuccess: () => { refresh(); setReason(""); toast("Caixa reaberto"); }, onError: err,
  });
  const d = q.data;
  const s = d?.summary;
  const c = d?.closing;
  const countedCents = parseBRL(counted);

  return (
    <div className="row">
      <div className="stack gap-18 grow-2">
        <div className="between no-print" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label className="field" style={{ width: 200 }}>DIA DO CAIXA
            <input className="input" type="date" value={day} max={isoDay(new Date())} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>Imprimir fechamento</button>
        </div>
        <h2 className="italic-title print-only" style={{ fontSize: 22 }}>Fechamento de caixa · {dayLabel(day)}</h2>

        {!s ? <Spinner /> : (
          <>
            <div className="kpis">
              <Kpi label="RECEBIDO NO DIA" value={money(s.received_cents)} accent sub={plural(Object.values(s.by_channel).reduce((a, b) => a + b.count, 0), "lançamento", "lançamentos")} />
              <Kpi label="ESTORNOS" value={money(s.refunded_cents)} />
              <Kpi label="LÍQUIDO" value={money(s.net_cents)} />
              <Kpi label="DINHEIRO NA GAVETA" value={money(s.cash_expected_cents)} sub="esperado pelo sistema" />
            </div>

            <Panel title="Recebimentos por forma">
              <div className="table-scroll">
                <table className="table rt" style={{ minWidth: 480 }}>
                  <thead><tr><th>FORMA</th><th>QTD.</th><th>RECEBIDO</th><th>ESTORNADO</th><th>LÍQUIDO</th></tr></thead>
                  <tbody>
                    {Object.entries(s.by_channel).map(([k, v]) => (
                      <tr key={k} style={{ opacity: v.count || v.refunded_cents ? 1 : 0.45 }}>
                        <td className="rt-title">{CHANNEL_LABEL[k]}</td><td data-label="Qtd.">{v.count}</td><td data-label="Recebido">{money(v.received_cents)}</td><td data-label="Estornado">{money(v.refunded_cents)}</td>
                        <td data-label="Líquido" style={{ fontWeight: 800 }}>{money(v.received_cents - v.refunded_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Locações do dia">
              <div className="kpis" style={{ marginBottom: 14 }}>
                <Kpi label="JOGOS" value={s.games.played} sub={`${hours(s.games.minutes)} · ${plural(s.games.cancelled, "cancelado", "cancelados")}`} />
                <Kpi label="VALOR DAS LOCAÇÕES" value={money(s.games.value_cents)} />
                <Kpi label="FICOU A RECEBER" value={money(s.games.open_cents)} sub={plural(s.games.open_count, "reserva no local", "reservas no local")} />
                <Kpi label="SEM CHECK-IN" value={s.games.no_checkin} sub="jogos encerrados" />
              </div>
              <table className="table rt">
                <thead><tr><th>QUADRA</th><th>JOGOS</th><th>HORAS</th><th>VALOR</th></tr></thead>
                <tbody>{s.by_court.map((b) => <tr key={b.name}><td className="rt-title">{b.name}</td><td data-label="Jogos">{b.bookings}</td><td data-label="Horas">{hours(b.minutes)}</td><td data-label="Valor">{money(b.value_cents)}</td></tr>)}</tbody>
              </table>
            </Panel>

            {c?.locked ? (
              <Panel title={<>Caixa fechado <Diff cents={c.cash_counted_cents - c.cash_expected_cents} /></>}>
                <div className="stack gap-14" style={{ fontSize: 14, fontWeight: 600 }}>
                  <p>Fechado por <b>{c.closed_by_name}</b> em {fmtDT(c.closed_at)}.</p>
                  <p>Recebido no fechamento: <b>{money(c.received_cents)}</b> · dinheiro esperado <b>{money(c.cash_expected_cents)}</b> · contado <b>{money(c.cash_counted_cents)}</b></p>
                  {c.note && <p className="muted">Obs.: {c.note}</p>}
                  {d!.drift && (d!.drift.received_cents !== 0 || d!.drift.refunded_cents !== 0) && (
                    <p className="alert alert-red" style={{ padding: 12, borderRadius: 12 }}>
                      Movimento depois do fechamento: {money(d!.drift.received_cents)} recebidos e {money(d!.drift.refunded_cents)} estornados (pagamentos online). Reabra e feche de novo para incorporar.
                    </p>
                  )}
                  <form className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
                    onSubmit={async (e) => { e.preventDefault(); if (await confirm({ title: "Reabrir o caixa?", message: "Lançamentos de balcão voltam a ser aceitos nesse dia. O fechamento atual fica no histórico.", confirmLabel: "Reabrir caixa" })) reopen.mutate(); }}>
                    <label className="field" style={{ flex: "1 1 260px" }}>MOTIVO DA REABERTURA
                      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: faltou lançar um débito" minLength={3} required />
                    </label>
                    <button className="btn btn-outline" style={{ height: 50 }} disabled={reopen.isPending}>Reabrir caixa</button>
                  </form>
                </div>
              </Panel>
            ) : (
              <Panel title="Fechar caixa">
                {c?.reopened_at && <p className="badge badge-cream" style={{ marginBottom: 12 }}>Reaberto por {c.reopened_by_name} em {fmtDT(c.reopened_at)}</p>}
                {!d!.can_close ? <p className="empty">Esse dia ainda não começou.</p> : (
                  <form style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, alignItems: "end" }}
                    onSubmit={(e) => { e.preventDefault(); if (!Number.isNaN(countedCents)) close.mutate(); }}>
                    <label className="field">DINHEIRO CONTADO NA GAVETA (R$)
                      <input className="input" inputMode="decimal" placeholder={money(s.cash_expected_cents)} value={counted} onChange={(e) => setCounted(e.target.value)} required />
                    </label>
                    <label className="field">OBSERVAÇÃO
                      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                    </label>
                    <button className="btn btn-primary" style={{ height: 50 }} disabled={close.isPending || Number.isNaN(countedCents) || counted === ""}>Fechar caixa</button>
                    {counted !== "" && !Number.isNaN(countedCents) && <div><Diff cents={countedCents - s.cash_expected_cents} /></div>}
                  </form>
                )}
                <p className="muted" style={{ fontSize: 12, fontWeight: 600, marginTop: 10 }}>
                  Depois de fechado, o banco recusa recebimentos de balcão nesse dia. Pix e cartão online continuam entrando e aparecem como movimento após o fechamento.
                </p>
              </Panel>
            )}
            {!!c?.history.length && (
              <Panel title="Histórico de reaberturas">
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, fontWeight: 600, display: "flex", flexDirection: "column", gap: 6 }}>
                  {c.history.map((h, i) => <li key={i}>Fechado {fmtDT(h.closed_at)} (contado {money(h.cash_counted_cents)} de {money(h.cash_expected_cents)}) · reaberto {fmtDT(h.reopened_at)} — {h.reason}</li>)}
                </ul>
              </Panel>
            )}
          </>
        )}
      </div>

      <aside className="stack gap-18 grow-1 no-print">
        <Panel title="Fechamentos do mês">
          {!mq.data ? <Spinner /> : (
            <>
              {!!mq.data.pending_days.length && (
                <div style={{ marginBottom: 14 }}>
                  <p className="label" style={{ fontSize: 12, fontWeight: 800, color: "var(--red-deep)" }}>DIAS COM MOVIMENTO SEM FECHAMENTO</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {mq.data.pending_days.map((p) => <button key={p} className="time-chip" onClick={() => setDay(p)}>{dayLabel(p)}</button>)}
                  </div>
                </div>
              )}
              {!mq.data.items.length ? <p className="empty">Nenhum fechamento.</p> : (
                <table className="table" style={{ fontSize: 13 }}>
                  <thead><tr><th>DIA</th><th>RECEBIDO</th><th>GAVETA</th></tr></thead>
                  <tbody>
                    {mq.data.items.map((r) => (
                      <tr key={r.day} onClick={() => setDay(r.day)} style={{ cursor: "pointer" }}>
                        <td>{dayLabel(r.day)}{!r.locked && <div className="muted" style={{ fontSize: 11 }}>reaberto</div>}</td>
                        <td>{money(r.received_cents)}</td>
                        <td>{r.cash_counted_cents === r.cash_expected_cents ? "✓" : money(r.cash_counted_cents - r.cash_expected_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Panel>
      </aside>
    </div>
  );
}
