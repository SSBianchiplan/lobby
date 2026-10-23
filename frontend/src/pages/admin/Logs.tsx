import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Spinner } from "../../components/Layout";
import { Kpi, Panel, PeriodPicker, periodLabel, usePeriod } from "./shared";

type Group = { key: string | number; views: number; visitors: number };
type Visitors = {
  views: number; visitors: number; sessions: number; logged: number; bot_views: number; new_visitors: number; pages_per_session: number;
  by_day: { day: string; views: number; visitors: number }[]; by_hour: Group[];
  pages: Group[]; referrers: Group[]; devices: Group[]; browsers: Group[]; os: Group[];
  recent: { at: string; path: string; referrer: string | null; device: string; browser: string; os: string; ip_prefix: string | null; is_bot: boolean; visitor: string; user_name: string | null }[];
};
type Access = {
  counts: Record<string, number>;
  top_failed_emails: { email: string; n: number; last: string }[];
  top_failed_ips: { ip: string; n: number }[];
  items: { id: number; at: string; event: string; email: string | null; ip: string | null; user_name: string | null; actor_name: string | null; device: string; browser: string; os: string }[];
};

export const EVENT_LABEL: Record<string, { text: string; cls: string }> = {
  login_ok: { text: "Login", cls: "badge-ok" },
  login_fail: { text: "Senha errada", cls: "badge-red" },
  login_locked: { text: "Bloqueado (tentativas)", cls: "badge-red" },
  login_inactive: { text: "Conta inativa", cls: "badge-cream" },
  register: { text: "Cadastro", cls: "badge-ball" },
  password_change: { text: "Trocou a senha", cls: "badge-off" },
  logout_all: { text: "Saiu de todos", cls: "badge-off" },
  password_reset: { text: "Senha redefinida", cls: "badge-cream" },
  account_disabled: { text: "Inativado", cls: "badge-red" },
  account_enabled: { text: "Reativado", cls: "badge-ok" },
  account_deleted: { text: "Excluído", cls: "badge-red" },
  user_created: { text: "Criado pelo admin", cls: "badge-ball" },
};
const DEVICE: Record<string, string> = { mobile: "Celular", tablet: "Tablet", desktop: "Computador" };
const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function Logs() {
  return (
    <div className="stack gap-18">
      <nav className="chips no-print" aria-label="Logs" style={{ flexWrap: "wrap" }}>
        <NavLink end to="/admin/acessos" className={({ isActive }) => `chip-link${isActive ? " active" : ""}`}>Visitantes do site</NavLink>
        <NavLink to="/admin/acessos/log" className={({ isActive }) => `chip-link${isActive ? " active" : ""}`}>Log de acessos</NavLink>
      </nav>
      <Routes>
        <Route index element={<VisitorsView />} />
        <Route path="log" element={<AccessView />} />
      </Routes>
    </div>
  );
}

function Bars({ items, label, max }: { items: Group[]; label: (k: Group["key"]) => string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.views));
  if (!items.length) return <p className="empty">Sem dados no período.</p>;
  return (
    <ul className="log-bars">
      {items.map((i) => (
        <li key={String(i.key)}>
          <span className="log-bars-label" title={label(i.key)}>{label(i.key)}</span>
          <span className="bar"><i style={{ width: `${(i.views / top) * 100}%` }} /></span>
          <span className="log-bars-n">{i.views}<small> · {i.visitors} vis.</small></span>
        </li>
      ))}
    </ul>
  );
}

function VisitorsView() {
  const period = usePeriod("last7");
  const [bots, setBots] = useState(false);
  const { start, end } = period.period;
  const q = useQuery({ queryKey: ["admin", "logs", "visitors", start, end, bots], placeholderData: keepPreviousData, refetchInterval: 60_000,
    queryFn: () => api<Visitors>(`/api/admin/logs/visitors?start=${start}&end=${end}${bots ? "&bots=true" : ""}`) });
  const d = q.data;
  const maxDay = Math.max(1, ...(d?.by_day.map((x) => x.views) ?? [1]));
  const hours = Array.from({ length: 24 }, (_, h) => d?.by_hour.find((x) => Number(x.key) === h)?.views ?? 0);
  const maxHour = Math.max(1, ...hours);
  return (
    <>
      <div className="between" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <PeriodPicker value={period} />
        <label className="cal-toggle"><input type="checkbox" checked={bots} onChange={(e) => setBots(e.target.checked)} />Incluir robôs</label>
      </div>
      {!d ? <Spinner /> : (
        <>
          <div className="kpis">
            <Kpi label="VISITANTES ÚNICOS" value={d.visitors} accent sub={`${d.new_visitors} novos · ${periodLabel(period.period)}`} />
            <Kpi label="VISUALIZAÇÕES" value={d.views} sub={`${d.pages_per_session} páginas por visita`} />
            <Kpi label="VISITAS (SESSÕES)" value={d.sessions} />
            <Kpi label="COM LOGIN" value={d.logged} sub={`${d.bot_views} acessos de robôs filtrados`} />
          </div>
          <Panel title="Visitas por dia">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 150 }} role="img" aria-label="Visualizações por dia">
              {d.by_day.map((x) => (
                <div key={x.day} title={`${x.day.split("-").reverse().slice(0, 2).join("/")} · ${x.views} visualizações · ${x.visitors} visitantes`}
                  style={{ flex: 1, minWidth: 4, height: `${Math.max(3, (x.views / maxDay) * 100)}%`, background: "var(--red)", borderRadius: "4px 4px 0 0", position: "relative" }}>
                  <i style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${(x.visitors / Math.max(1, x.views)) * 100}%`, background: "var(--ball)", borderRadius: 3 }} />
                </div>
              ))}
            </div>
            {!d.by_day.length ? <p className="empty">Sem visitas no período.</p> : <p className="muted" style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>Vermelho: visualizações · amarelo: visitantes</p>}
          </Panel>
          <div className="log-grid">
            <Panel title="Páginas mais vistas"><Bars items={d.pages} label={(k) => String(k)} /></Panel>
            <Panel title="De onde vêm"><Bars items={d.referrers} label={(k) => String(k)} /></Panel>
            <Panel title="Aparelhos"><Bars items={d.devices} label={(k) => DEVICE[String(k)] ?? String(k)} /></Panel>
            <Panel title="Navegadores"><Bars items={d.browsers} label={(k) => String(k)} /></Panel>
            <Panel title="Sistemas"><Bars items={d.os} label={(k) => String(k)} /></Panel>
            <Panel title="Horário das visitas">
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 110 }} role="img" aria-label="Visitas por hora do dia">
                {hours.map((n, h) => <div key={h} title={`${h}h · ${n}`} style={{ flex: 1, height: `${Math.max(2, (n / maxHour) * 100)}%`, background: n ? "var(--red)" : "var(--off-bg)", borderRadius: 2 }} />)}
              </div>
              <div className="between muted" style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}><span>0h</span><span>12h</span><span>23h</span></div>
            </Panel>
          </div>
          <Panel title="Visitas recentes">
            {!d.recent.length ? <p className="empty">Nenhuma visita.</p> : (
              <div className="table-scroll">
                <table className="table rt" style={{ minWidth: 760 }}>
                  <thead><tr><th>QUANDO</th><th>PÁGINA</th><th>ORIGEM</th><th>APARELHO</th><th>VISITANTE</th></tr></thead>
                  <tbody>
                    {d.recent.map((r, i) => (
                      <tr key={i}>
                        <td className="rt-title" style={{ whiteSpace: "nowrap" }}>{fmt(r.at)}</td>
                        <td data-label="Página"><code>{r.path}</code></td>
                        <td data-label="Origem">{r.referrer ?? <span className="muted">direto</span>}</td>
                        <td data-label="Aparelho">{DEVICE[r.device]} · {r.os} · {r.browser}{r.is_bot && <span className="badge badge-off" style={{ marginLeft: 6 }}>robô</span>}</td>
                        <td data-label="Visitante">{r.user_name ?? <span className="muted">anônimo #{r.visitor}</span>}<div className="muted" style={{ fontSize: 11 }}>{r.ip_prefix ?? ""}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <p className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Privacidade: visitante é um código aleatório do navegador, o IP fica truncado e códigos de convite/QR não são registrados. Telas internas (admin, recepção, professor) não entram. Quem ativa “não rastrear” no navegador não é contado. Registros com mais de 180 dias são apagados.</p>
        </>
      )}
    </>
  );
}

function AccessView() {
  const period = usePeriod("last7");
  const [event, setEvent] = useState("");
  const [term, setTerm] = useState("");
  const { start, end } = period.period;
  const q = useQuery({ queryKey: ["admin", "logs", "access", start, end, event, term], placeholderData: keepPreviousData, refetchInterval: 30_000,
    queryFn: () => api<Access>(`/api/admin/logs/access?start=${start}&end=${end}${event ? `&event=${event}` : ""}&q=${encodeURIComponent(term)}`) });
  const d = q.data;
  const c = d?.counts ?? {};
  return (
    <>
      <PeriodPicker value={period} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label className="field" style={{ flex: "2 1 240px" }}>BUSCAR<input className="input" placeholder="E-mail, nome ou IP" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
        <label className="field" style={{ flex: "1 1 200px" }}>EVENTO
          <select className="select" value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="">Todos</option>{Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
        </label>
      </div>
      {!d ? <Spinner /> : (
        <>
          <div className="kpis">
            <Kpi label="LOGINS" value={c.login_ok ?? 0} accent />
            <Kpi label="SENHAS ERRADAS" value={c.login_fail ?? 0} sub={`${c.login_locked ?? 0} bloqueios por tentativas`} />
            <Kpi label="CADASTROS" value={(c.register ?? 0) + (c.user_created ?? 0)} sub={`${c.user_created ?? 0} criados pelo admin`} />
            <Kpi label="AÇÕES DA ADMINISTRAÇÃO" value={(c.password_reset ?? 0) + (c.account_disabled ?? 0) + (c.account_enabled ?? 0) + (c.account_deleted ?? 0)} sub="senhas, inativações, exclusões" />
          </div>
          {(d.top_failed_emails.length > 0 || d.top_failed_ips.length > 0) && (
            <div className="log-grid">
              <Panel title="E-mails com mais falhas">
                <ul className="roster">{d.top_failed_emails.map((f) => <li key={f.email}><span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}><strong>{f.email}</strong><br /><small className="muted">última {fmt(f.last)}</small></span><span className="badge badge-red">{f.n}</span></li>)}</ul>
              </Panel>
              <Panel title="IPs com mais falhas">
                <ul className="roster">{d.top_failed_ips.map((f) => <li key={f.ip}><span style={{ flex: 1 }}><code>{f.ip}</code></span><span className="badge badge-red">{f.n}</span></li>)}</ul>
              </Panel>
            </div>
          )}
          <Panel title="Eventos">
            {!d.items.length ? <p className="empty">Nenhum evento no período.</p> : (
              <div className="table-scroll">
                <table className="table rt" style={{ minWidth: 820 }}>
                  <thead><tr><th>QUANDO</th><th>EVENTO</th><th>CONTA</th><th>IP</th><th>APARELHO</th><th>FEITO POR</th></tr></thead>
                  <tbody>
                    {d.items.map((r) => (
                      <tr key={r.id}>
                        <td className="rt-title" style={{ whiteSpace: "nowrap" }}>{fmt(r.at)}</td>
                        <td data-label="Evento"><span className={`badge ${EVENT_LABEL[r.event]?.cls ?? "badge-off"}`}>{EVENT_LABEL[r.event]?.text ?? r.event}</span></td>
                        <td data-label="Conta"><span style={{ overflowWrap: "anywhere" }}>{r.user_name ?? "—"}<div className="muted" style={{ fontSize: 12 }}>{r.email}</div></span></td>
                        <td data-label="IP"><code>{r.ip ?? "—"}</code></td>
                        <td data-label="Aparelho">{DEVICE[r.device]} · {r.os} · {r.browser}</td>
                        <td data-label="Feito por">{r.actor_name ?? <span className="muted">a própria pessoa</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
