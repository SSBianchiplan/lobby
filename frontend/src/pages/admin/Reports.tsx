import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Spinner } from "../../components/Layout";
import { money, PAY_LABEL } from "../../format";
import { useClub } from "../../hooks";
import { downloadCsv, hours, Kpi, pct, PeriodPicker, Panel, periodLabel, usePeriod, WD_SHORT } from "./shared";

type Group = { key: string | number; label: string | number; rentals: number; minutes: number; gross_cents: number; paid_cents: number };
type Report = {
  start: string; end: string; rentals: number; minutes: number; gross_cents: number; paid_cents: number; open_cents: number;
  refunded_cents: number; cancelled: number; expired: number; clients: number; capacity_minutes: number; occupancy: number; avg_ticket_cents: number;
  by_day: Group[]; by_court: Group[]; by_weekday: Group[]; by_hour: Group[]; by_method: Group[]; by_duration: Group[]; by_client: Group[];
};
const GROUPS = [
  ["day", "Por dia"], ["court", "Por quadra"], ["weekday", "Por dia da semana"], ["hour", "Por horário"],
  ["client", "Por cliente"], ["method", "Por forma de pagamento"], ["duration", "Por duração"],
] as const;
type GroupKey = (typeof GROUPS)[number][0];

const label = (g: GroupKey, v: Group) =>
  g === "weekday" ? WD_SHORT[Number(v.label)] : g === "method" ? PAY_LABEL[String(v.label)] ?? v.label : String(v.label);

export default function Reports() {
  const club = useClub().data;
  const period = usePeriod("month");
  const [court, setCourt] = useState("");
  const [group, setGroup] = useState<GroupKey>("day");
  const { start, end } = period.period;
  const qs = `start=${start}&end=${end}${court ? `&court_id=${court}` : ""}`;
  const q = useQuery({ queryKey: ["admin", "rentals", qs], queryFn: () => api<Report>(`/api/admin/reports/rentals?${qs}`), placeholderData: keepPreviousData });
  const d = q.data;
  const rows = d ? d[`by_${group}`] : [];
  const max = Math.max(1, ...rows.map((r) => r.gross_cents));
  const maxDay = Math.max(1, ...(d?.by_day.map((r) => r.gross_cents) ?? [1]));
  const courtName = club?.courts.find((c) => String(c.id) === court)?.name;

  return (
    <div className="stack gap-18">
      <div className="between no-print" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <PeriodPicker value={period} />
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label className="field" style={{ width: 170 }}>QUADRA
            <select className="select" value={court} onChange={(e) => setCourt(e.target.value)}>
              <option value="">Todas</option>
              {club?.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="btn btn-outline btn-sm" style={{ height: 50 }} onClick={() => window.print()}>Imprimir</button>
        </div>
      </div>
      <h2 className="italic-title print-only" style={{ fontSize: 22 }}>Relatório de locações · {periodLabel(period.period)}{courtName && ` · ${courtName}`}</h2>

      {!d ? <Spinner /> : (
        <>
          <div className="kpis">
            <Kpi label="LOCAÇÕES" value={d.rentals} sub={`${d.clients} clientes · ${d.cancelled} canceladas · ${d.expired} expiradas`} />
            <Kpi label="HORAS LOCADAS" value={hours(d.minutes)} sub={`de ${hours(d.capacity_minutes)} disponíveis`}>
              <div className="bar" style={{ marginTop: 8 }}><i style={{ width: pct(Math.min(1, d.occupancy)) }} /></div>
            </Kpi>
            <Kpi label="OCUPAÇÃO" value={pct(d.occupancy)} />
            <Kpi label="FATURAMENTO" value={money(d.gross_cents)} accent sub={`ticket médio ${money(d.avg_ticket_cents)}`} />
            <Kpi label="RECEBIDO" value={money(d.paid_cents)} sub={`${money(d.open_cents)} a receber`} />
            <Kpi label="ESTORNADO" value={money(d.refunded_cents)} />
          </div>

          <Panel title="Faturamento por dia">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 160 }} role="img" aria-label={`Faturamento diário, maior valor ${money(maxDay)}`}>
              {d.by_day.map((x) => (
                <div key={String(x.key)} title={`${x.label} · ${money(x.gross_cents)} · ${x.rentals} locações`}
                  style={{ flex: 1, height: `${Math.max(2, (x.gross_cents / maxDay) * 100)}%`, background: "var(--red)", borderRadius: "4px 4px 0 0", minWidth: 4 }} />
              ))}
            </div>
            {!d.by_day.length && <p className="empty">Sem locações no período.</p>}
          </Panel>

          <Panel title="Detalhamento" actions={
            <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`/api/admin/reports/rentals.csv?${qs}&group=${group}`, `locacoes-${group}-${start}.csv`)}>Exportar CSV</button>
          }>
            <div className="chips no-print" role="tablist" aria-label="Agrupar por" style={{ flexWrap: "wrap", marginBottom: 12 }}>
              {GROUPS.map(([k, l]) => <button key={k} role="tab" aria-selected={group === k} aria-pressed={group === k} onClick={() => setGroup(k)}>{l}</button>)}
            </div>
            {!rows.length ? <p className="empty">Sem locações no período.</p> : (
              <div className="table-scroll">
                <table className="table rt" style={{ minWidth: 640 }}>
                  <thead><tr><th>{GROUPS.find(([k]) => k === group)![1].replace("Por ", "").toUpperCase()}</th><th>LOCAÇÕES</th><th>HORAS</th><th>FATURAMENTO</th><th>RECEBIDO</th><th style={{ width: "28%" }}><span className="sr-only">Proporção</span></th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={String(r.key)}>
                        <td className="rt-title" style={{ fontWeight: 800 }}>{label(group, r)}</td>
                        <td data-label="Locações">{r.rentals}</td><td data-label="Horas">{hours(r.minutes)}</td><td data-label="Faturamento">{money(r.gross_cents)}</td><td data-label="Recebido">{money(r.paid_cents)}</td>
                        <td><div className="bar" style={{ flex: 1 }}><i style={{ width: `${(r.gross_cents / max) * 100}%` }} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 900 }}>
                    <td className="rt-title" style={{ padding: 12 }}>Total</td><td data-label="Locações" style={{ padding: 12 }}>{group === "client" ? rows.reduce((a, r) => a + r.rentals, 0) : d.rentals}</td>
                    <td data-label="Horas" style={{ padding: 12 }}>{hours(rows.reduce((a, r) => a + r.minutes, 0))}</td>
                    <td data-label="Faturamento" style={{ padding: 12 }}>{money(rows.reduce((a, r) => a + r.gross_cents, 0))}</td>
                    <td data-label="Recebido" style={{ padding: 12 }}>{money(rows.reduce((a, r) => a + r.paid_cents, 0))}</td><td className="rt-hide-m" />
                  </tr></tfoot>
                </table>
                {group === "client" && <p className="muted" style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>Os 50 clientes com maior faturamento no período.</p>}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
