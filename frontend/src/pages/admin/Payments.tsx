import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Reservation } from "../../api";
import { Spinner } from "../../components/Layout";
import { money } from "../../format";
import { CHANNEL_LABEL, downloadCsv, Kpi, PeriodPicker, Panel, periodLabel, ResTable, useAdminActions, usePeriod } from "./shared";

type Move = {
  kind: "received" | "refunded"; at: string; amount_cents: number; id: number; channel: string; note: string | null;
  code: string; court: string; client: string; starts_at: string; admin: string | null; manual: boolean;
};
type Pay = {
  items: Move[]; received_cents: number; refunded_cents: number; receivable_cents: number; receivable: Reservation[];
  by_channel: Record<string, { received_cents: number; refunded_cents: number; count: number }>;
};

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function Payments() {
  const period = usePeriod("today");
  const [kind, setKind] = useState<"all" | "received" | "refunded">("all");
  const [channel, setChannel] = useState("");
  const { start, end } = period.period;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "payments", start, end, kind, channel],
    queryFn: () => api<Pay>(`/api/admin/payments?start=${start}&end=${end}&kind=${kind}${channel ? `&channel=${channel}` : ""}`),
    refetchInterval: 30_000,
  });
  const actions = useAdminActions(() => qc.invalidateQueries({ queryKey: ["admin"] }));
  const d = q.data;

  return (
    <div className="stack gap-18">
      <Panel title={<>A receber {d && <span className="accent">· {money(d.receivable_cents)}</span>}</>}>
        <p className="muted" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          Reservas "no local" ainda não pagas e Pix aguardando confirmação. Ao receber no balcão, escolha a forma — o valor entra no caixa de hoje.
        </p>
        {!d ? <Spinner /> : <ResTable items={d.receivable} actions={actions} showDate />}
      </Panel>

      <PeriodPicker value={period} />
      {d && (
        <div className="kpis">
          <Kpi label="RECEBIDO" value={money(d.received_cents)} accent sub={periodLabel(period.period)} />
          <Kpi label="ESTORNADO" value={money(d.refunded_cents)} />
          <Kpi label="LÍQUIDO" value={money(d.received_cents - d.refunded_cents)} />
        </div>
      )}

      {d && (
        <Panel title="Por forma de pagamento">
          <div className="table-scroll">
            <table className="table" style={{ minWidth: 520 }}>
              <thead><tr><th>FORMA</th><th>LANÇAMENTOS</th><th>RECEBIDO</th><th>ESTORNADO</th><th>LÍQUIDO</th></tr></thead>
              <tbody>
                {Object.entries(d.by_channel).filter(([, v]) => v.count || v.refunded_cents).map(([k, v]) => (
                  <tr key={k}><td>{CHANNEL_LABEL[k]}</td><td>{v.count}</td><td>{money(v.received_cents)}</td><td>{money(v.refunded_cents)}</td><td style={{ fontWeight: 800 }}>{money(v.received_cents - v.refunded_cents)}</td></tr>
                ))}
              </tbody>
            </table>
            {!Object.values(d.by_channel).some((v) => v.count || v.refunded_cents) && <p className="empty">Sem movimento no período.</p>}
          </div>
        </Panel>
      )}

      <Panel title="Movimento" actions={<>
        <select className="select" style={{ height: 40, width: 150 }} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Tipo">
          <option value="all">Tudo</option><option value="received">Recebimentos</option><option value="refunded">Estornos</option>
        </select>
        <select className="select" style={{ height: 40, width: 190 }} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Forma">
          <option value="">Todas as formas</option>
          {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`/api/admin/payments.csv?start=${start}&end=${end}`, `pagamentos-${start}.csv`)}>Exportar CSV</button>
      </>}>
        {!d ? <Spinner /> : !d.items.length ? <p className="empty">Nenhum lançamento.</p> : (
          <div className="table-scroll">
            <table className="table" style={{ minWidth: 860 }}>
              <thead><tr><th>QUANDO</th><th>TIPO</th><th>FORMA</th><th>RESERVA</th><th>CLIENTE</th><th>LANÇADO POR</th><th style={{ textAlign: "right" }}>VALOR</th></tr></thead>
              <tbody>
                {d.items.map((m) => (
                  <tr key={`${m.kind}-${m.id}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(m.at)}</td>
                    <td><span className={`badge ${m.kind === "received" ? "badge-ok" : "badge-off"}`}>{m.kind === "received" ? "Recebimento" : "Estorno"}</span></td>
                    <td>{CHANNEL_LABEL[m.channel]}</td>
                    <td><code style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{m.code}</code><div className="muted" style={{ fontSize: 12 }}>{m.court} · {fmtDateTime(m.starts_at)}</div></td>
                    <td>{m.client}{m.note && <div className="muted" style={{ fontSize: 12 }}>{m.note}</div>}</td>
                    <td>{m.admin ?? <span className="muted">online</span>}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, color: m.amount_cents < 0 ? "var(--red-deep)" : undefined }}>{money(m.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
