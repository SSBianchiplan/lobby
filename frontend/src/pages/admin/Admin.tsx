import { useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Reservation } from "../../api";
import { BottomNav, SiteHeader, Spinner } from "../../components/Layout";
import { useToast } from "../../components/Toast";
import { dayLabel, isoDay, money } from "../../format";
import { useClub } from "../../hooks";
import Bookings from "./Bookings";
import Calendar from "./Calendar";
import Classes from "./Classes";
import ClosingPage from "./Closing";
import Occupancy from "./Occupancy";
import Payments from "./Payments";
import Reports from "./Reports";
import Settings from "./Settings";
import { downloadCsv, pct, ResTable, useAdminActions } from "./shared";
import Logs from "./Logs";
import Manual from "./Manual";
import Users from "./Users";

const TABS: [string, string][] = [
  ["/admin", "Painel"], ["/admin/agenda", "Agenda do dia"], ["/admin/calendario", "Calendário"], ["/admin/agendamentos", "Agendamentos"],
  ["/admin/disponibilidade", "Disponibilidade"], ["/admin/aulas", "Aulas"], ["/admin/pagamentos", "Pagamentos"], ["/admin/fechamento", "Fechamento"],
  ["/admin/relatorios", "Relatórios"], ["/admin/usuarios", "Usuários"], ["/admin/acessos", "Acessos"], ["/admin/config", "Configurações"],
];

export default function Admin() {
  return (
    <div className="has-bottom-nav">
      <SiteHeader />
      <main className="container page">
        <div className="between">
          <h1 className="italic-title" style={{ fontSize: 36 }}>Administração <span className="accent">Padel Lobby</span></h1>
          <Link to="/recepcao" className="btn btn-primary btn-sm no-print" style={{ height: 44 }}>Leitor de check-in (câmera)</Link>
          <nav className="admin-tabs no-print" aria-label="Administração">
            {TABS.map(([to, label]) => <NavLink key={to} end={to === "/admin"} to={to} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>)}
          </nav>
        </div>
        <div style={{ marginTop: 24 }}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="agenda" element={<DaySchedule />} />
            <Route path="calendario" element={<Calendar />} />
            <Route path="agendamentos" element={<Bookings />} />
            <Route path="reservas" element={<Bookings />} />
            <Route path="disponibilidade" element={<Occupancy />} />
            <Route path="aulas/*" element={<Classes />} />
            <Route path="pagamentos" element={<Payments />} />
            <Route path="fechamento" element={<ClosingPage />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="usuarios" element={<Users />} />
            <Route path="manual" element={<Manual />} />
            <Route path="acessos/*" element={<Logs />} />
            <Route path="config" element={<Settings />} />
          </Routes>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

type Dash = {
  start: string; end: string; bookings: number; cancelled: number; expired: number; pending: number;
  revenue_cents: number; receivable_cents: number; booked_minutes: number; players: number; capacity_minutes: number; occupancy: number;
  by_court: { name: string; minutes: number; bookings: number; revenue_cents: number; occupancy: number }[];
  heat: { weekday: number; hour: number; n: number }[];
  daily: { day: string; bookings: number; revenue_cents: number }[];
  top_players: { name: string; bookings: number; minutes: number }[];
};

function monthRange(offset: number) {
  const d = new Date();
  const s = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const e = new Date(d.getFullYear(), d.getMonth() + offset + 1, 1);
  return { start: isoDay(s), end: isoDay(e), label: s.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase()) };
}

function Dashboard() {
  const [offset, setOffset] = useState(0);
  const range = monthRange(offset);
  const q = useQuery({ queryKey: ["admin", "dash", range.start], queryFn: () => api<Dash>(`/api/admin/dashboard?start=${range.start}&end=${range.end}`) });
  const d = q.data;
  const maxDaily = Math.max(1, ...(d?.daily.map((x) => x.revenue_cents) ?? [1]));
  const maxHeat = Math.max(1, ...(d?.heat.map((x) => x.n) ?? [1]));
  const hours = Array.from({ length: 15 }, (_, i) => 9 + i);
  const wds = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  return (
    <div className="stack gap-18">
      <div className="between">
        <div className="chips" role="group" aria-label="Mês">
          <button onClick={() => setOffset(offset - 1)} aria-label="Mês anterior">←</button>
          <button aria-pressed="true">{range.label}</button>
          <button onClick={() => setOffset(offset + 1)} aria-label="Próximo mês">→</button>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`/api/admin/reports/reservations.csv?start=${range.start}&end=${range.end}`, `reservas-${range.start}.csv`)}>Exportar CSV</button>
      </div>
      {!d ? <Spinner /> : (
        <>
          <div className="kpis">
            <div className="kpi"><p className="label">RECEITA RECEBIDA</p><p className="value accent">{money(d.revenue_cents)}</p><p className="sub">+ {money(d.receivable_cents)} a receber no local</p></div>
            <div className="kpi"><p className="label">OCUPAÇÃO</p><p className="value">{pct(d.occupancy)}</p><div className="bar" style={{ marginTop: 8 }}><i style={{ width: pct(Math.min(1, d.occupancy)) }} /></div></div>
            <div className="kpi"><p className="label">RESERVAS</p><p className="value">{d.bookings}</p><p className="sub">{d.cancelled} canceladas · {d.expired} expiradas · {d.pending} aguardando</p></div>
            <div className="kpi"><p className="label">HORAS VENDIDAS</p><p className="value">{Math.round(d.booked_minutes / 60)}</p><p className="sub">de {Math.round(d.capacity_minutes / 60)} h disponíveis · {d.players} clientes</p></div>
          </div>

          <div className="row">
            <section className="card card-pad grow-2" style={{ boxShadow: "none" }}>
              <h2 className="italic-title" style={{ fontSize: 18 }}>Receita por dia</h2>
              <div style={{ marginTop: 16, display: "flex", alignItems: "flex-end", gap: 3, height: 160 }} role="img"
                aria-label={`Receita diária, maior valor ${money(maxDaily)}`}>
                {d.daily.map((x) => (
                  <div key={x.day} title={`${dayLabel(x.day)} · ${money(x.revenue_cents)} · ${x.bookings} reservas`}
                    style={{ flex: 1, height: `${Math.max(2, (x.revenue_cents / maxDaily) * 100)}%`, background: "var(--red)", borderRadius: "4px 4px 0 0", minWidth: 4 }} />
                ))}
              </div>
              {!d.daily.length && <p className="empty">Sem reservas no período.</p>}
            </section>
            <section className="card card-pad grow-1" style={{ boxShadow: "none" }}>
              <h2 className="italic-title" style={{ fontSize: 18 }}>Por quadra</h2>
              <div className="stack gap-14" style={{ marginTop: 14 }}>
                {d.by_court.map((c) => (
                  <div key={c.name}>
                    <div className="between" style={{ fontSize: 14, fontWeight: 700 }}><span>{c.name}</span><span>{pct(c.occupancy)} · {money(c.revenue_cents)}</span></div>
                    <div className="bar" style={{ marginTop: 6 }}><i style={{ width: pct(Math.min(1, c.occupancy)) }} /></div>
                  </div>
                ))}
              </div>
              <h2 className="italic-title" style={{ fontSize: 18, marginTop: 22 }}>Quem mais joga</h2>
              <ol style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: 14, fontWeight: 600, display: "flex", flexDirection: "column", gap: 6 }}>
                {d.top_players.map((p) => <li key={p.name}>{p.name} <span className="muted">· {p.bookings} jogos</span></li>)}
              </ol>
            </section>
          </div>

          <section className="card card-pad" style={{ boxShadow: "none" }}>
            <h2 className="italic-title" style={{ fontSize: 18 }}>Mapa de calor · reservas por dia e hora</h2>
            <div className="table-scroll">
              <div className="heat" style={{ marginTop: 14, gridTemplateColumns: `48px repeat(${hours.length}, minmax(28px, 1fr))`, minWidth: 560 }}>
                <span />
                {hours.map((h) => <span key={h} style={{ textAlign: "center" }}>{h}h</span>)}
                {wds.map((w, i) => (
                  <div key={w} style={{ display: "contents" }}>
                    <span style={{ alignSelf: "center" }}>{w}</span>
                    {hours.map((h) => {
                      const n = d.heat.find((x) => x.weekday === i + 1 && x.hour === h)?.n ?? 0;
                      return <div key={h} className="cell" title={`${w} ${h}h · ${n} reservas`}
                        style={{ background: n ? `rgba(200,16,46,${0.12 + 0.88 * (n / maxHeat)})` : "var(--bg)" }} />;
                    })}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

type Schedule = { date: string; reservations: Reservation[]; blocks: { id: number; court_id: number | null; starts: string; ends: string; reason: string }[] };

function DaySchedule() {
  const club = useClub().data;
  const [date, setDate] = useState(() => isoDay(new Date()));
  const [code, setCode] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "schedule", date], queryFn: () => api<Schedule>(`/api/admin/schedule?date=${date}`), refetchInterval: 20_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const actions = useAdminActions(refresh);
  const [block, setBlock] = useState({ court_id: "", start: "12:00", end: "13:00", reason: "Manutenção" });
  const addBlock = useMutation({
    mutationFn: () => api("/api/admin/blocks", { method: "POST", json: { ...block, court_id: block.court_id ? Number(block.court_id) : null, date } }),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["availability"] }); toast("Horário bloqueado"); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Falhou."),
  });
  const delBlock = useMutation({ mutationFn: (id: number) => api(`/api/admin/blocks/${id}`, { method: "DELETE" }), onSuccess: () => { refresh(); toast("Bloqueio removido"); } });

  return (
    <div className="stack gap-18">
      <div className="row">
        <form className="card card-pad grow-1" style={{ boxShadow: "none", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}
          onSubmit={(e) => { e.preventDefault(); if (code.trim()) actions.checkin.mutate(code.trim(), { onSuccess: () => setCode("") }); }}>
          <label className="field" style={{ flex: "1 1 200px" }}>CHECK-IN POR CÓDIGO
            <input className="input" placeholder="PL-XXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" />
          </label>
          <button className="btn btn-primary" style={{ height: 50 }}>Fazer check-in</button>
        </form>
        <label className="card card-pad field grow-1" style={{ boxShadow: "none" }}>DIA
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <section className="card card-pad" style={{ boxShadow: "none" }}>
        <h2 className="italic-title" style={{ fontSize: 20, marginBottom: 10 }}>Reservas de {dayLabel(date)}</h2>
        {q.isLoading ? <Spinner /> : <ResTable items={q.data?.reservations ?? []} actions={actions} />}
      </section>

      <section className="card card-pad" style={{ boxShadow: "none" }}>
        <h2 className="italic-title" style={{ fontSize: 20 }}>Bloqueios</h2>
        <form style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, alignItems: "end" }}
          onSubmit={(e) => { e.preventDefault(); addBlock.mutate(); }}>
          <label className="field">QUADRA
            <select className="select" value={block.court_id} onChange={(e) => setBlock({ ...block, court_id: e.target.value })}>
              <option value="">Todas</option>
              {club?.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">INÍCIO<input className="input" type="time" step={1800} value={block.start} onChange={(e) => setBlock({ ...block, start: e.target.value })} /></label>
          <label className="field">FIM<input className="input" type="time" step={1800} value={block.end} onChange={(e) => setBlock({ ...block, end: e.target.value })} /></label>
          <label className="field">MOTIVO<input className="input" value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} /></label>
          <button className="btn btn-dark" style={{ height: 50 }} disabled={addBlock.isPending}>Bloquear</button>
        </form>
        <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {q.data?.blocks.map((b) => (
            <li key={b.id} className="between" style={{ padding: "10px 14px", borderRadius: 14, background: "var(--bg)", fontSize: 14, fontWeight: 700 }}>
              <span>{b.starts} – {b.ends} · {b.court_id ? club?.courts.find((c) => c.id === b.court_id)?.name : "Todas as quadras"} · {b.reason}</span>
              <button className="text-link" onClick={() => delBlock.mutate(b.id)}>Remover</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
