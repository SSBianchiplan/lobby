import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Reservation } from "../../api";
import { Spinner } from "../../components/Layout";
import { money, PAY_LABEL, STATUS_LABEL } from "../../format";
import { useClub } from "../../hooks";
import { downloadCsv, hours, Kpi, PAY_STATUS, PeriodPicker, Panel, periodLabel, ResTable, useAdminActions, usePeriod } from "./shared";

type Page = { n: number; value_cents: number; paid_cents: number; open_cents: number; minutes: number; items: Reservation[] };
const LIMIT = 50;

export default function Bookings() {
  const club = useClub().data;
  const period = usePeriod("next7");
  const [f, setF] = useState({ q: "", court_id: "", status: "", payment_status: "", method: "", order: "asc" });
  const [page, setPage] = useState(0);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(0); };
  const qs = new URLSearchParams({ start: period.period.start, end: period.period.end, order: f.order, offset: String(page * LIMIT), limit: String(LIMIT) });
  for (const k of ["q", "court_id", "status", "payment_status", "method"] as const) if (f[k]) qs.set(k, f[k]);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "bookings", qs.toString()], queryFn: () => api<Page>(`/api/admin/bookings?${qs}`), placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const actions = useAdminActions(() => qc.invalidateQueries({ queryKey: ["admin"] }));
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.n / LIMIT)) : 1;

  return (
    <div className="stack gap-18">
      <PeriodPicker value={{ ...period, choose: (k) => { period.choose(k); setPage(0); }, custom: (p) => { period.custom(p); setPage(0); } }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <label className="field" style={{ gridColumn: "span 2" }}>BUSCAR
          <input className="input" placeholder="Código, nome, e-mail ou telefone" value={f.q} onChange={set("q")} />
        </label>
        <label className="field">QUADRA
          <select className="select" value={f.court_id} onChange={set("court_id")}>
            <option value="">Todas</option>
            {club?.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">SITUAÇÃO
          <select className="select" value={f.status} onChange={set("status")}>
            <option value="">Todas</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
        </label>
        <label className="field">PAGAMENTO
          <select className="select" value={f.payment_status} onChange={set("payment_status")}>
            <option value="">Todos</option>
            {Object.entries(PAY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
        </label>
        <label className="field">FORMA
          <select className="select" value={f.method} onChange={set("method")}>
            <option value="">Todas</option>
            {Object.entries(PAY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">ORDEM
          <select className="select" value={f.order} onChange={set("order")}>
            <option value="asc">Mais cedo primeiro</option>
            <option value="desc">Mais recente primeiro</option>
          </select>
        </label>
      </div>

      {d && (
        <div className="kpis">
          <Kpi label="AGENDAMENTOS" value={d.n} sub={periodLabel(period.period)} />
          <Kpi label="HORAS LOCADAS" value={hours(d.minutes)} />
          <Kpi label="VALOR DAS LOCAÇÕES" value={money(d.value_cents)} accent sub={`${money(d.paid_cents)} pago`} />
          <Kpi label="EM ABERTO" value={money(d.open_cents)} sub="no local ou aguardando Pix" />
        </div>
      )}

      <Panel title={`Agendamentos · ${periodLabel(period.period)}`} actions={
        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`/api/admin/reports/reservations.csv?start=${period.period.start}&end=${period.period.end}`, `agendamentos-${period.period.start}.csv`)}>Exportar CSV</button>
      }>
        {!d ? <Spinner /> : <ResTable items={d.items} actions={actions} showDate />}
        {d && pages > 1 && (
          <div className="between" style={{ marginTop: 12, fontSize: 14, fontWeight: 700 }}>
            <button className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Anteriores</button>
            <span className="muted">Página {page + 1} de {pages}</span>
            <button className="btn btn-outline btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Próximos →</button>
          </div>
        )}
      </Panel>
    </div>
  );
}
