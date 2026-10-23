import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Spinner } from "../../components/Layout";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../auth";
import { dayLabel } from "../../format";
import DemoPurge from "./DemoPurge";

type Rule = { label: string; weekdays: number[]; holidays: boolean; starts: string; ends: string; cents_per_hour: number; priority: number; is_promo: boolean };
type Holiday = { day: string; name: string; open: boolean };
const WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const NUMERIC: [string, string][] = [
  ["cancel_free_hours", "Cancelamento grátis até (h antes)"],
  ["pending_hold_minutes", "Prazo para pagar o Pix (min)"],
  ["booking_horizon_days", "Antecedência máxima (dias)"],
  ["max_players", "Jogadores por quadra"],
  ["max_active_per_user", "Reservas futuras por cliente"],
];
const TEXT: [string, string][] = [
  ["whatsapp", "WhatsApp do clube (com DDI, ex. 5553999990000)"],
  ["email", "E-mail"],
  ["promo_text", "Texto da promoção"],
  ["pix_key", "Chave Pix"],
  ["pix_merchant_name", "Nome no Pix"],
];

export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const err = (e: unknown) => toast(e instanceof ApiError ? e.message : "Falhou.");
  const done = (m: string) => () => { qc.invalidateQueries(); toast(m); };

  const rulesQ = useQuery({ queryKey: ["admin", "rules"], queryFn: () => api<Rule[]>("/api/admin/price-rules") });
  const [rules, setRules] = useState<Rule[]>([]);
  useEffect(() => { if (rulesQ.data) setRules(rulesQ.data); }, [rulesQ.data]);
  const saveRules = useMutation({ mutationFn: () => api("/api/admin/price-rules", { method: "PUT", json: rules }), onSuccess: done("Preços salvos"), onError: err });

  const setQ = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<Record<string, unknown>>("/api/admin/settings") });
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  useEffect(() => { if (setQ.data) setCfg(setQ.data); }, [setQ.data]);
  const saveCfg = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const [k] of [...NUMERIC, ...TEXT]) body[k] = cfg[k];
      body.durations = cfg.durations;
      return api("/api/admin/settings", { method: "PUT", json: body });
    },
    onSuccess: done("Configurações salvas"), onError: err,
  });

  const holQ = useQuery({ queryKey: ["admin", "holidays"], queryFn: () => api<Holiday[]>("/api/admin/holidays") });
  const [hol, setHol] = useState<Holiday>({ day: "", name: "", open: true });
  const addHol = useMutation({ mutationFn: () => api("/api/admin/holidays", { method: "POST", json: hol }), onSuccess: () => { setHol({ day: "", name: "", open: true }); done("Feriado salvo")(); }, onError: err });
  const delHol = useMutation({ mutationFn: (day: string) => api(`/api/admin/holidays/${day}`, { method: "DELETE" }), onSuccess: done("Feriado removido") });

  const upd = (i: number, p: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div className="stack gap-18">
      <section className="card card-pad" style={{ boxShadow: "none" }}>
        <div className="between">
          <h2 className="italic-title" style={{ fontSize: 20 }}>Tabela de preços</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setRules([...rules, { label: "Nova faixa", weekdays: [1, 2, 3, 4, 5], holidays: false, starts: "12:00", ends: "18:00", cents_per_hour: 10000, priority: 0, is_promo: false }])}>Adicionar faixa</button>
            <button className="btn btn-primary btn-sm" disabled={saveRules.isPending} onClick={() => saveRules.mutate()}>Salvar preços</button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>O preço é calculado a cada 30 min; vale a faixa de maior prioridade. Marque "feriado" para aplicar a faixa em feriados.</p>
        {rulesQ.isLoading ? <Spinner /> : (
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table className="table" style={{ minWidth: 900 }}>
              <thead><tr><th>NOME</th><th>DIAS</th><th>INÍCIO</th><th>FIM</th><th>R$/HORA</th><th>PRIOR.</th><th>PROMO</th><th /></tr></thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={i}>
                    <td><input className="input" style={{ height: 40 }} aria-label="Nome" value={r.label} onChange={(e) => upd(i, { label: e.target.value })} /></td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {WD.map((w, k) => (
                          <label key={w} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 2 }}>
                            <input type="checkbox" checked={r.weekdays.includes(k + 1)}
                              onChange={(e) => upd(i, { weekdays: e.target.checked ? [...r.weekdays, k + 1].sort() : r.weekdays.filter((x) => x !== k + 1) })} />{w}
                          </label>
                        ))}
                        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 2 }}>
                          <input type="checkbox" checked={r.holidays} onChange={(e) => upd(i, { holidays: e.target.checked })} />feriado
                        </label>
                      </div>
                    </td>
                    <td><input className="input" style={{ height: 40 }} type="time" aria-label="Início" value={r.starts.slice(0, 5)} onChange={(e) => upd(i, { starts: e.target.value })} /></td>
                    <td><input className="input" style={{ height: 40 }} type="time" aria-label="Fim" value={r.ends.slice(0, 5)} onChange={(e) => upd(i, { ends: e.target.value === "23:59" ? "23:59:59" : e.target.value })} /></td>
                    <td><input className="input" style={{ height: 40, width: 100 }} type="number" min={1} step={1} aria-label="Reais por hora" value={r.cents_per_hour / 100} onChange={(e) => upd(i, { cents_per_hour: Math.round(Number(e.target.value) * 100) })} /></td>
                    <td><input className="input" style={{ height: 40, width: 70 }} type="number" aria-label="Prioridade" value={r.priority} onChange={(e) => upd(i, { priority: Number(e.target.value) })} /></td>
                    <td><input type="checkbox" aria-label="Promoção" checked={r.is_promo} onChange={(e) => upd(i, { is_promo: e.target.checked })} /></td>
                    <td><button className="text-link" onClick={() => setRules(rules.filter((_, j) => j !== i))}>Remover</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="row">
        <form className="card card-pad grow-2" style={{ boxShadow: "none", display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => { e.preventDefault(); saveCfg.mutate(); }}>
          <h2 className="italic-title" style={{ fontSize: 20 }}>Regras e dados do clube</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {NUMERIC.map(([k, label]) => (
              <label key={k} className="field">{label.toUpperCase()}
                <input className="input" type="number" min={0} value={Number(cfg[k] ?? 0)} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} />
              </label>
            ))}
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ marginBottom: 6 }}>DURAÇÕES OFERECIDAS</legend>
              <div style={{ display: "flex", gap: 12, alignItems: "center", height: 50 }}>
                {[60, 90, 120].map((d) => {
                  const list = (cfg.durations as number[] | undefined) ?? [];
                  return (
                    <label key={d} style={{ display: "flex", gap: 4, alignItems: "center", color: "var(--ink)", fontSize: 14 }}>
                      <input type="checkbox" checked={list.includes(d)} onChange={(e) => setCfg({ ...cfg, durations: e.target.checked ? [...list, d].sort((a, b) => a - b) : list.filter((x) => x !== d) })} />{d} min
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
          {TEXT.map(([k, label]) => (
            <label key={k} className="field">{label.toUpperCase()}
              <input className="input" value={String(cfg[k] ?? "")} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
            </label>
          ))}
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={saveCfg.isPending}>Salvar configurações</button>
        </form>

        <section className="card card-pad grow-1" style={{ boxShadow: "none" }}>
          <h2 className="italic-title" style={{ fontSize: 20 }}>Feriados</h2>
          <p className="muted" style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>Feriado aberto usa o horário de sábado e o preço promocional.</p>
          <form style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }} onSubmit={(e) => { e.preventDefault(); addHol.mutate(); }}>
            <label className="field">DATA<input className="input" type="date" required value={hol.day} onChange={(e) => setHol({ ...hol, day: e.target.value })} /></label>
            <label className="field">NOME<input className="input" required minLength={2} value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 700 }}>
              <input type="checkbox" checked={hol.open} onChange={(e) => setHol({ ...hol, open: e.target.checked })} />Clube abre nesse dia
            </label>
            <button className="btn btn-dark btn-sm" style={{ alignSelf: "flex-start" }}>Adicionar feriado</button>
          </form>
          <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
            {holQ.data?.map((h) => (
              <li key={h.day} className="between" style={{ fontSize: 14, fontWeight: 600, padding: "8px 12px", borderRadius: 12, background: "var(--bg)" }}>
                <span><strong>{dayLabel(h.day)}/{h.day.slice(2, 4)}</strong> · {h.name} {h.open ? "" : <span className="badge badge-off">fechado</span>}</span>
                <button className="text-link" onClick={() => delHol.mutate(h.day)}>Remover</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {user?.is_master && <DemoPurge />}
    </div>
  );
}
