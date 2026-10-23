import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Spinner } from "../../components/Layout";
import { Modal, useConfirm } from "../../components/Modal";
import { QR } from "../../components/QR";
import { TicketActions } from "../../components/Ticket";
import { useToast } from "../../components/Toast";
import { addMinutes, coachQrUrl, dayLabel, firstName, isoDay, LEVEL_LABEL, money } from "../../format";
import { useClub } from "../../hooks";
import { ClientPicker, type PickedClient } from "./ClientPicker";
import { CHANNEL_LABEL, COUNTER_CHANNELS, Kpi, Panel, pct } from "./shared";

// ── Tipos ───────────────────────────────────────────────────────────────────

type Coach = { id: number; name: string; phone: string | null; email: string | null; color: string; active: boolean; groups: number; login_email: string | null };
type Group = {
  id: number; name: string; coach_id: number; court_id: number; weekdays: number[]; starts: string; duration_min: number;
  level: string | null; capacity: number; monthly_price_cents: number; dropin_price_cents: number; starts_on: string; ends_on: string | null;
  active: boolean; notes: string | null; coach_name: string; coach_color: string; court_name: string; enrolled: number;
  next_session: string | null; schedule: string;
};
type Session = {
  id: number; group_id: number | null; coach_id: number; court_id: number; starts_at: string; ends_at: string; status: "scheduled" | "done" | "cancelled";
  name: string; level: string | null; capacity: number | null; coach_name: string; coach_color: string; court_name: string;
  present: number; expected: number; cancel_reason: string | null; started_at: string | null; coach_checked_in_at: string | null; notes: string | null;
};
type RosterRow = { user_id: number; name: string; phone: string | null; level: string | null; status: "present" | "absent" | "justified" | null; dropin: boolean | null; checked_in_at: string | null; open_cents: number };
type Generation = { created: number; skipped: { date: string; reason: string }[] };

const WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayOf = (iso: string) => isoDay(new Date(iso));
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Falhou.");
const genText = (g: Generation) => `${g.created} aula(s) criada(s)${g.skipped.length ? ` · ${g.skipped.length} dia(s) pulado(s): ${g.skipped.slice(0, 3).map((s) => `${dayLabel(s.date)} (${s.reason})`).join(", ")}` : ""}`;

const TABS: [string, string][] = [["", "Agenda de aulas"], ["turmas", "Turmas"], ["alunos", "Alunos"], ["mensalidades", "Mensalidades"], ["professores", "Professores"]];

export default function Classes() {
  return (
    <div className="stack gap-18">
      <nav className="chips no-print" aria-label="Aulas" style={{ flexWrap: "wrap" }}>
        {TABS.map(([to, label]) => (
          <NavLink key={to} end to={`/admin/aulas${to ? `/${to}` : ""}`} className={({ isActive }) => `chip-link${isActive ? " active" : ""}`}>{label}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Agenda />} />
        <Route path="turmas" element={<Groups />} />
        <Route path="alunos" element={<Students />} />
        <Route path="mensalidades" element={<Charges />} />
        <Route path="professores" element={<Coaches />} />
      </Routes>
    </div>
  );
}

// ── Agenda de aulas ─────────────────────────────────────────────────────────

function Agenda() {
  const [start, setStart] = useState(() => isoDay(new Date()));
  const [open, setOpen] = useState<number | null>(null);
  const [privateOpen, setPrivateOpen] = useState(false);
  const q = useQuery({ queryKey: ["admin", "class-sessions", start], queryFn: () => api<Session[]>(`/api/admin/class-sessions?start=${start}&days=7`), placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const sum = useQuery({ queryKey: ["admin", "classes-summary"], queryFn: () => api<{ sessions: number; cancelled: number; presences: number; attendance_rate: number | null; students: number; groups: number; paid_cents: number; open_cents: number }>("/api/admin/classes/summary") });
  const shift = (d: number) => { const [y, m, dd] = start.split("-").map(Number); setStart(isoDay(new Date(y!, m! - 1, dd! + d))); };
  const byDay = new Map<string, Session[]>();
  for (const s of q.data ?? []) byDay.set(dayOf(s.starts_at), [...(byDay.get(dayOf(s.starts_at)) ?? []), s]);
  const s = sum.data;

  return (
    <>
      {s && (
        <div className="kpis">
          <Kpi label="ALUNOS ATIVOS" value={s.students} sub={`${s.groups} turmas`} />
          <Kpi label="AULAS NO MÊS" value={s.sessions} sub={`${s.cancelled} canceladas`} />
          <Kpi label="FREQUÊNCIA" value={s.attendance_rate === null ? "—" : pct(s.attendance_rate)} sub={`${s.presences} presenças no mês`} />
          <Kpi label="MENSALIDADES" value={money(s.paid_cents)} accent sub={`${money(s.open_cents)} em aberto`} />
        </div>
      )}
      <div className="between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="chips" role="group" aria-label="Semana">
          <button onClick={() => shift(-7)} aria-label="Semana anterior">←</button>
          <button aria-pressed="true">{dayLabel(start)} a {dayLabel(isoDay(new Date(new Date(start + "T12:00").getTime() + 6 * 86400000)))}</button>
          <button onClick={() => shift(7)} aria-label="Próxima semana">→</button>
          <button onClick={() => setStart(isoDay(new Date()))}>Hoje</button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setPrivateOpen(true)}>+ Aula particular</button>
      </div>
      {!q.data ? <Spinner /> : !q.data.length ? <p className="empty">Nenhuma aula nesta semana. Crie uma turma em "Turmas" ou uma aula particular.</p> : (
        [...byDay.entries()].map(([day, list]) => (
          <Panel key={day} title={dayLabel(day)}>
            <ul className="class-list">
              {list.map((x) => (
                <li key={x.id}>
                  <button type="button" className={`class-item ${x.status}`} onClick={() => setOpen(x.id)} style={{ borderLeftColor: x.coach_color }}>
                    <span className="class-time">{hhmm(x.starts_at)}<small>{hhmm(x.ends_at)}</small></span>
                    <span style={{ flex: "1 1 180px", minWidth: 0 }}>
                      <strong>{x.name}</strong>{x.level && <span className="badge badge-cream" style={{ marginLeft: 6 }}>{LEVEL_LABEL[x.level]}</span>}
                      <br /><small className="muted">{x.coach_name} · {x.court_name}</small>
                    </span>
                    <span className="class-count">{x.status === "cancelled" ? <span className="badge badge-off">Cancelada</span>
                      : <><b>{x.present}</b>/{x.expected}<small>{x.status === "done" ? "presentes" : x.started_at ? "em aula" : "alunos"}</small></>}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
      <SessionModal id={open} onClose={() => setOpen(null)} />
      <PrivateModal open={privateOpen} onClose={() => setPrivateOpen(false)} />
    </>
  );
}

/** Aula: chamada (presente/falta/justificada), aluno avulso, cancelar. Usado também pela grade de Disponibilidade. */
export function SessionModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState<PickedClient>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["admin", "class-session", id], enabled: id !== null, queryFn: () => api<Session & { roster: RosterRow[] }>(`/api/admin/class-sessions/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin"] }); };
  const mark = useMutation({
    mutationFn: (v: { user_id: number; status: string }) => api(`/api/admin/class-sessions/${id}/attendance`, { method: "POST", json: v }),
    onSuccess: refresh, onError: (e) => toast(errMsg(e)),
  });
  const add = useMutation({
    mutationFn: () => api(`/api/admin/class-sessions/${id}/students`, { method: "POST", json: adding }),
    onSuccess: () => { refresh(); setShowAdd(false); setAdding(null); toast("Aluno incluído na aula"); }, onError: (e) => toast(errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/admin/class-sessions/${id}/cancel`, { method: "POST", json: { reason } }),
    onSuccess: () => { refresh(); toast("Aula cancelada e alunos avisados"); setReason(""); }, onError: (e) => toast(errMsg(e)),
  });
  const s = q.data;
  const presenceOpen = !!s && Date.now() >= new Date(s.starts_at).getTime() - 3600_000;
  return (
    <Modal open={id !== null} onClose={() => { setShowAdd(false); onClose(); }} width={640}
      title={s ? <>{s.name} · {dayLabel(dayOf(s.starts_at))} {hhmm(s.starts_at)}</> : "Aula"}>
      {!s ? <Spinner /> : (
        <div className="stack gap-14">
          <p className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
            {s.coach_name} · {s.court_name} · {hhmm(s.starts_at)}–{hhmm(s.ends_at)}
            {s.status === "cancelled" && <> · <span className="badge badge-off">Cancelada: {s.cancel_reason}</span></>}
            {s.started_at && s.status !== "cancelled" && <> · iniciada às {hhmm(s.started_at)}</>}
            {s.coach_checked_in_at && <> · professor chegou às {hhmm(s.coach_checked_in_at)}</>}
          </p>
          {s.notes && <p style={{ padding: "10px 12px", borderRadius: 12, background: "var(--cream)", color: "var(--cream-ink)", fontSize: 13, fontWeight: 600 }}>📝 {s.notes}</p>}
          <h3 className="field" style={{ margin: 0 }}>CHAMADA · {s.present} presente(s)</h3>
          {!s.roster.length ? <p className="empty">Nenhum aluno nesta aula ainda.</p> : (
            <ul className="roster">
              {s.roster.map((r) => (
                <li key={r.user_id}>
                  <span style={{ flex: "1 1 180px", minWidth: 0 }}>
                    <strong>{r.name}</strong>{r.dropin && <span className="badge badge-cream" style={{ marginLeft: 6 }}>avulso</span>}
                    <br /><small className="muted">{r.phone ?? ""}{r.checked_in_at && ` · QR às ${hhmm(r.checked_in_at)}`}{r.open_cents > 0 && <span style={{ color: "var(--red-deep)" }}> · {money(r.open_cents)} em aberto</span>}</small>
                  </span>
                  <span className="attend" role="group" aria-label={`Presença de ${r.name}`}>
                    {([["present", "Presente"], ["absent", "Falta"], ["justified", "Justif."]] as const).map(([v, l]) => (
                      <button key={v} type="button" className={v} aria-pressed={r.status === v}
                        disabled={s.status === "cancelled" || mark.isPending || (v === "present" && !presenceOpen)}
                        title={v === "present" && !presenceOpen ? "Presença a partir de 1 h antes da aula" : undefined}
                        onClick={() => mark.mutate({ user_id: r.user_id, status: v })}>{l}</button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {s.status !== "cancelled" && (showAdd ? (
            <form className="card card-pad" style={{ boxShadow: "none", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}
              onSubmit={(e) => { e.preventDefault(); if (adding) add.mutate(); }}>
              <ClientPicker onChange={setAdding} label="ALUNO AVULSO" />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancelar</button>
                <button className="btn btn-primary btn-sm" disabled={!adding || add.isPending}>Incluir presente</button>
              </div>
            </form>
          ) : <button type="button" className="btn btn-soft btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setShowAdd(true)}>+ Aluno avulso</button>)}
          {s.status === "scheduled" && (
            <form style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 14 }}
              onSubmit={async (e) => { e.preventDefault(); if (await confirm({ title: "Cancelar esta aula?", message: "Os alunos recebem um aviso. A quadra fica livre para reservas.", confirmLabel: "Cancelar aula", danger: true })) cancel.mutate(); }}>
              <label className="field" style={{ flex: "1 1 220px" }}>MOTIVO DO CANCELAMENTO<input className="input" required minLength={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <button className="btn btn-outline" style={{ height: 50 }} disabled={cancel.isPending}>Cancelar aula</button>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

function PrivateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const club = useClub().data;
  const qc = useQueryClient();
  const toast = useToast();
  const coaches = useQuery({ queryKey: ["admin", "coaches"], queryFn: () => api<Coach[]>("/api/admin/coaches"), enabled: open });
  const [f, setF] = useState({ coach_id: "", court_id: "", date: isoDay(new Date()), start: "18:00", duration_min: 60, title: "Aula particular", price: "" });
  const [student, setStudent] = useState<PickedClient>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api("/api/admin/class-sessions", { method: "POST", json: {
      coach_id: Number(f.coach_id), court_id: Number(f.court_id), date: f.date, start: f.start, duration_min: f.duration_min,
      title: f.title || null, price_cents: Math.round(Number(f.price.replace(",", ".") || 0) * 100),
      user_ids: student && "user_id" in student ? [student.user_id] : [],
      client: student && "client" in student ? student.client : null,
    } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast("Aula agendada"); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title="Nova aula particular" width={600}>
      <form style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <label className="field" style={{ gridColumn: "1 / -1" }}>TÍTULO<input className="input" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="field">PROFESSOR
            <select className="select" required value={f.coach_id} onChange={(e) => setF({ ...f, coach_id: e.target.value })}>
              <option value="">Escolha</option>{coaches.data?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">QUADRA
            <select className="select" required value={f.court_id} onChange={(e) => setF({ ...f, court_id: e.target.value })}>
              <option value="">Escolha</option>{club?.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">DATA<input className="input" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="field">INÍCIO<input className="input" type="time" step={1800} required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
          <label className="field">DURAÇÃO
            <select className="select" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: Number(e.target.value) })}>
              {[60, 90, 120].map((d) => <option key={d} value={d}>{d} min · até {addMinutes(f.start, d)}</option>)}
            </select>
          </label>
          <label className="field">VALOR POR ALUNO (R$)<input className="input" inputMode="decimal" placeholder="0,00" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        </div>
        <ClientPicker onChange={setStudent} label="ALUNO (OPCIONAL)" />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={save.isPending || !f.coach_id || !f.court_id}>Agendar aula</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Turmas ──────────────────────────────────────────────────────────────────

function Groups() {
  const [edit, setEdit] = useState<Group | "new" | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const q = useQuery({ queryKey: ["admin", "class-groups", showClosed], queryFn: () => api<Group[]>(`/api/admin/class-groups${showClosed ? "?active=false" : ""}`) });
  return (
    <>
      <div className="between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="chips" role="group">
          <button aria-pressed={!showClosed} onClick={() => setShowClosed(false)}>Ativas</button>
          <button aria-pressed={showClosed} onClick={() => setShowClosed(true)}>Encerradas</button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEdit("new")}>+ Nova turma</button>
      </div>
      {!q.data ? <Spinner /> : !q.data.length ? <p className="empty">{showClosed ? "Nenhuma turma encerrada." : "Nenhuma turma ainda. Cadastre um professor e crie a primeira turma."}</p> : (
        <div className="group-grid">
          {q.data.map((g) => (
            <button key={g.id} type="button" className="group-card" style={{ borderTopColor: g.coach_color }} onClick={() => setEdit(g)}>
              <span className="between" style={{ width: "100%" }}><strong style={{ fontSize: 17 }}>{g.name}</strong>
                {g.level && <span className="badge badge-cream">{LEVEL_LABEL[g.level]}</span>}</span>
              <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>{g.schedule}</span>
              <span style={{ fontSize: 13 }}>{g.coach_name} · {g.court_name}</span>
              <span className="bar" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, (g.enrolled / g.capacity) * 100)}%` }} /></span>
              <span className="between" style={{ width: "100%", fontSize: 13, fontWeight: 700 }}>
                <span>{g.enrolled}/{g.capacity} alunos</span><span>{money(g.monthly_price_cents)}/mês</span>
              </span>
              {g.next_session && <small className="muted">Próxima: {dayLabel(dayOf(g.next_session))} {hhmm(g.next_session)}</small>}
            </button>
          ))}
        </div>
      )}
      <GroupModal group={edit} onClose={() => setEdit(null)} />
    </>
  );
}

const emptyGroup = { name: "", coach_id: "", court_id: "", weekdays: [] as number[], starts: "19:00", duration_min: 60, level: "", capacity: 4, monthly: "", dropin: "", ends_on: "", notes: "" };

function GroupModal({ group, onClose }: { group: Group | "new" | null; onClose: () => void }) {
  const club = useClub().data;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = group === "new";
  const g = group && group !== "new" ? group : null;
  const coaches = useQuery({ queryKey: ["admin", "coaches"], queryFn: () => api<Coach[]>("/api/admin/coaches"), enabled: !!group });
  const [f, setF] = useState(emptyGroup);
  const [loadedFor, setLoadedFor] = useState<number | "new" | null>(null);
  const key = g ? g.id : isNew ? "new" : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setF(g ? { name: g.name, coach_id: String(g.coach_id), court_id: String(g.court_id), weekdays: g.weekdays, starts: g.starts.slice(0, 5), duration_min: g.duration_min,
      level: g.level ?? "", capacity: g.capacity, monthly: String(g.monthly_price_cents / 100).replace(".", ","), dropin: String(g.dropin_price_cents / 100).replace(".", ","),
      ends_on: g.ends_on ?? "", notes: g.notes ?? "" } : emptyGroup);
  }
  const cents = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".") || 0) * 100);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ generation: Generation; removed?: number }>(g ? `/api/admin/class-groups/${g.id}` : "/api/admin/class-groups", {
      method: g ? "PUT" : "POST",
      json: { name: f.name, coach_id: Number(f.coach_id), court_id: Number(f.court_id), weekdays: f.weekdays, starts: f.starts, duration_min: f.duration_min,
        level: f.level || null, capacity: f.capacity, monthly_price_cents: cents(f.monthly), dropin_price_cents: cents(f.dropin), ends_on: f.ends_on || null, notes: f.notes || null },
    }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["admin"] }); toast(`Turma salva · ${genText(r.generation)}`); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  const close = useMutation({
    mutationFn: () => api(`/api/admin/class-groups/${g!.id}/close`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast("Turma encerrada"); onClose(); },
  });
  return (
    <Modal open={!!group} onClose={onClose} title={g ? g.name : "Nova turma"} width={720}>
      <form style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <label className="field" style={{ gridColumn: "1 / -1" }}>NOME DA TURMA<input className="input" required minLength={2} maxLength={80} placeholder="Ex.: Iniciantes noite" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">PROFESSOR
            <select className="select" required value={f.coach_id} onChange={(e) => setF({ ...f, coach_id: e.target.value })}>
              <option value="">Escolha</option>{coaches.data?.filter((c) => c.active || String(c.id) === f.coach_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">QUADRA
            <select className="select" required value={f.court_id} onChange={(e) => setF({ ...f, court_id: e.target.value })}>
              <option value="">Escolha</option>{club?.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">INÍCIO<input className="input" type="time" step={1800} required value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} /></label>
          <label className="field">DURAÇÃO
            <select className="select" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: Number(e.target.value) })}>
              {[60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>
          </label>
          <label className="field">NÍVEL
            <select className="select" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
              <option value="">Livre</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">VAGAS<input className="input" type="number" min={1} max={12} value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></label>
          <label className="field">MENSALIDADE (R$)<input className="input" inputMode="decimal" placeholder="0,00" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></label>
          <label className="field">AULA AVULSA (R$)<input className="input" inputMode="decimal" placeholder="0,00" value={f.dropin} onChange={(e) => setF({ ...f, dropin: e.target.value })} /></label>
          <label className="field">TERMINA EM (OPCIONAL)<input className="input" type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field" style={{ marginBottom: 6 }}>DIAS DA SEMANA</legend>
          <div className="chips" role="group" style={{ flexWrap: "wrap" }}>
            {WD.map((w, i) => (
              <button key={w} type="button" aria-pressed={f.weekdays.includes(i + 1)}
                onClick={() => setF({ ...f, weekdays: f.weekdays.includes(i + 1) ? f.weekdays.filter((x) => x !== i + 1) : [...f.weekdays, i + 1].sort() })}>{w}</button>
            ))}
          </div>
        </fieldset>
        <p className="muted" style={{ fontSize: 12, fontWeight: 600 }}>As aulas das próximas 4 semanas são criadas na hora e o calendário avança sozinho. Dias de clube fechado ou com a quadra ocupada são pulados e avisados.{g && " Mudar dia, horário, quadra ou professor refaz as aulas futuras que ainda não tiveram chamada."}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {g?.active && <button type="button" className="btn btn-outline" style={{ marginRight: "auto" }} disabled={close.isPending}
            onClick={async () => { if (await confirm({ title: "Encerrar turma?", message: "As aulas futuras são canceladas e as matrículas encerradas. O histórico fica.", confirmLabel: "Encerrar turma", danger: true })) close.mutate(); }}>Encerrar turma</button>}
          <button type="button" className="btn btn-outline" onClick={onClose}>Fechar</button>
          <button className="btn btn-primary" disabled={save.isPending || !f.weekdays.length}>{isNew ? "Criar turma" : "Salvar"}</button>
        </div>
      </form>
      {g && <Enrollments group={g} />}
    </Modal>
  );
}

function Enrollments({ group }: { group: Group }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [who, setWho] = useState<PickedClient>(null);
  const q = useQuery({ queryKey: ["admin", "enrollments", group.id], queryFn: () => api<{ id: number; status: string; user_id: number; name: string; phone: string | null; presences: number; open_cents: number }[]>(`/api/admin/class-groups/${group.id}/enrollments`) });
  const enroll = useMutation({
    mutationFn: () => api(`/api/admin/class-groups/${group.id}/enrollments`, { method: "POST", json: who }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast("Aluno matriculado"); setWho(null); }, onError: (e) => toast(errMsg(e)),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: number; status: string }) => api(`/api/admin/enrollments/${v.id}`, { method: "PUT", json: { status: v.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }), onError: (e) => toast(errMsg(e)),
  });
  const active = q.data?.filter((e) => e.status === "active").length ?? 0;
  return (
    <section style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
      <h3 className="italic-title" style={{ fontSize: 18 }}>Alunos · {active}/{group.capacity}</h3>
      {!q.data ? <Spinner /> : !q.data.length ? <p className="empty">Nenhum aluno matriculado.</p> : (
        <ul className="roster" style={{ marginTop: 10 }}>
          {q.data.map((e) => (
            <li key={e.id}>
              <span style={{ flex: "1 1 180px", minWidth: 0 }}><strong>{e.name}</strong>{e.status === "paused" && <span className="badge badge-off" style={{ marginLeft: 6 }}>pausada</span>}
                <br /><small className="muted">{e.phone ?? ""} · {e.presences} presenças{e.open_cents > 0 && <span style={{ color: "var(--red-deep)" }}> · {money(e.open_cents)} em aberto</span>}</small></span>
              <span style={{ display: "flex", gap: 6 }}>
                {e.status === "active"
                  ? <button className="btn btn-outline btn-sm" onClick={() => setStatus.mutate({ id: e.id, status: "paused" })}>Pausar</button>
                  : <button className="btn btn-outline btn-sm" onClick={() => setStatus.mutate({ id: e.id, status: "active" })}>Reativar</button>}
                <button className="btn btn-outline btn-sm" onClick={() => setStatus.mutate({ id: e.id, status: "cancelled" })}>Remover</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {group.active && active < group.capacity && (
        <form style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (who) enroll.mutate(); }}>
          <ClientPicker onChange={setWho} label="MATRICULAR ALUNO" />
          <button className="btn btn-dark btn-sm" style={{ alignSelf: "flex-end" }} disabled={!who || enroll.isPending}>Matricular</button>
        </form>
      )}
    </section>
  );
}

// ── Alunos ──────────────────────────────────────────────────────────────────

function Students() {
  const [term, setTerm] = useState("");
  const q = useQuery({ queryKey: ["admin", "students", term], placeholderData: keepPreviousData,
    queryFn: () => api<{ id: number; name: string; phone: string | null; email: string; level: string | null; groups: string | null; present_30d: number; absent_30d: number; open_cents: number }[]>(`/api/admin/students?q=${encodeURIComponent(term)}`) });
  return (
    <Panel title="Alunos">
      <label className="field" style={{ marginBottom: 12 }}>BUSCAR<input className="input" placeholder="Nome, e-mail ou telefone" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
      {!q.data ? <Spinner /> : !q.data.length ? <p className="empty">Nenhum aluno. Matricule alunos nas turmas.</p> : (
        <div className="table-scroll">
          <table className="table rt" style={{ minWidth: 820 }}>
            <thead><tr><th>ALUNO</th><th>CONTATO</th><th>TURMAS</th><th>NÍVEL</th><th>FREQUÊNCIA 30 DIAS</th><th>EM ABERTO</th></tr></thead>
            <tbody>
              {q.data.map((s) => {
                const total = s.present_30d + s.absent_30d;
                return (
                  <tr key={s.id}>
                    <td className="rt-title" style={{ fontWeight: 800 }}>{s.name}</td>
                    <td data-label="Contato">{s.phone || (s.email.endsWith("@padellobby.invalid") ? "balcão" : s.email)}</td>
                    <td data-label="Turmas">{s.groups ?? <span className="muted">avulso</span>}</td>
                    <td data-label="Nível">{s.level ? LEVEL_LABEL[s.level] : "—"}</td>
                    <td data-label="Frequência">{total ? `${pct(s.present_30d / total)} · ${s.present_30d}/${total}` : "—"}</td>
                    <td data-label="Em aberto" style={{ fontWeight: 800, color: s.open_cents ? "var(--red-deep)" : undefined }}>{money(s.open_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ── Mensalidades ────────────────────────────────────────────────────────────

type Charge = { id: number; student: string; phone: string | null; group_name: string | null; description: string; amount_cents: number; status: "open" | "paid" | "cancelled"; kind: string; paid_at: string | null; channel: string | null; received_by_name: string | null };

function Charges() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(() => isoDay(new Date()).slice(0, 7));
  const [st, setSt] = useState("");
  const [receiving, setReceiving] = useState<number | null>(null);
  const [channel, setChannel] = useState("dinheiro");
  const q = useQuery({ queryKey: ["admin", "charges", month, st], placeholderData: keepPreviousData,
    queryFn: () => api<{ items: Charge[]; open_cents: number; paid_cents: number }>(`/api/admin/charges?month=${month}-01${st ? `&status=${st}` : ""}`) });
  const gen = useMutation({
    mutationFn: () => api<{ created: number }>("/api/admin/charges/generate", { method: "POST", json: { month: `${month}-01` } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["admin"] }); toast(r.created ? `${r.created} mensalidade(s) gerada(s)` : "Nada novo: todas as mensalidades do mês já existem"); },
    onError: (e) => toast(errMsg(e)),
  });
  const receive = useMutation({
    mutationFn: (id: number) => api(`/api/admin/charges/${id}/receive`, { method: "POST", json: { channel } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); setReceiving(null); toast("Recebimento lançado no caixa"); }, onError: (e) => toast(errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api(`/api/admin/charges/${id}/cancel`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast("Cobrança cancelada"); }, onError: (e) => toast(errMsg(e)),
  });
  const d = q.data;
  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="field" style={{ width: 180 }}>MÊS<input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        <label className="field" style={{ width: 170 }}>SITUAÇÃO
          <select className="select" value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="">Todas</option><option value="open">Em aberto</option><option value="paid">Pagas</option><option value="cancelled">Canceladas</option>
          </select>
        </label>
        <button className="btn btn-primary" style={{ height: 50 }} disabled={gen.isPending}
          onClick={async () => { if (await confirm({ title: "Gerar mensalidades?", message: "Cria uma mensalidade para cada matrícula ativa em turmas com valor mensal. Rodar de novo não duplica.", confirmLabel: "Gerar" })) gen.mutate(); }}>Gerar mensalidades do mês</button>
      </div>
      {d && <div className="kpis"><Kpi label="EM ABERTO" value={money(d.open_cents)} accent /><Kpi label="RECEBIDO" value={money(d.paid_cents)} /><Kpi label="COBRANÇAS" value={d.items.length} /></div>}
      <Panel title="Cobranças">
        {!d ? <Spinner /> : !d.items.length ? <p className="empty">Nenhuma cobrança neste mês. Use "Gerar mensalidades do mês".</p> : (
          <div className="table-scroll">
            <table className="table rt" style={{ minWidth: 860 }}>
              <thead><tr><th>ALUNO</th><th>DESCRIÇÃO</th><th>VALOR</th><th>SITUAÇÃO</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {d.items.map((c) => (
                  <tr key={c.id}>
                    <td className="rt-title" style={{ fontWeight: 800 }}>{c.student}<div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{c.phone}</div></td>
                    <td data-label="Descrição">{c.description}</td>
                    <td data-label="Valor" style={{ fontWeight: 800 }}>{money(c.amount_cents)}</td>
                    <td data-label="Situação">{c.status === "paid" ? <span className="badge badge-ok">Pago · {CHANNEL_LABEL[c.channel ?? ""] ?? ""}</span> : c.status === "open" ? <span className="badge badge-red">Em aberto</span> : <span className="badge badge-off">Cancelada</span>}</td>
                    <td className="rt-actions" style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {c.status === "open" && (receiving === c.id ? (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <select className="select" style={{ height: 36, width: 140, fontSize: 13 }} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Forma de recebimento">
                            {COUNTER_CHANNELS.map((k) => <option key={k} value={k}>{CHANNEL_LABEL[k]}</option>)}
                          </select>
                          <button className="btn btn-primary btn-sm" disabled={receive.isPending} onClick={() => receive.mutate(c.id)}>{money(c.amount_cents)} ✓</button>
                          <button className="text-link" onClick={() => setReceiving(null)} aria-label="Fechar">✕</button>
                        </span>
                      ) : <button className="btn btn-soft btn-sm" onClick={() => setReceiving(c.id)}>Receber</button>)}
                      {c.status === "open" && receiving !== c.id && <button className="btn btn-outline btn-sm"
                        onClick={async () => { if (await confirm({ title: "Cancelar cobrança?", message: c.description, confirmLabel: "Cancelar cobrança", danger: true })) cancel.mutate(c.id); }}>Cancelar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Professores ─────────────────────────────────────────────────────────────

function Coaches() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "coaches"], queryFn: () => api<Coach[]>("/api/admin/coaches") });
  const [edit, setEdit] = useState<Coach | "new" | null>(null);
  const [card, setCard] = useState<number | null>(null);
  const [access, setAccess] = useState<Coach | null>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "", color: "#7C3AED", active: true });
  const open = (c: Coach | "new") => { setEdit(c); setF(c === "new" ? { name: "", phone: "", email: "", color: "#7C3AED", active: true } : { name: c.name, phone: c.phone ?? "", email: c.email ?? "", color: c.color, active: c.active }); };
  const save = useMutation({
    mutationFn: () => api(edit && edit !== "new" ? `/api/admin/coaches/${edit.id}` : "/api/admin/coaches", { method: edit && edit !== "new" ? "PUT" : "POST", json: { ...f, phone: f.phone || null, email: f.email || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast("Professor salvo"); setEdit(null); }, onError: (e) => toast(errMsg(e)),
  });
  return (
    <Panel title="Professores" actions={<button className="btn btn-primary btn-sm" onClick={() => open("new")}>+ Professor</button>}>
      {!q.data ? <Spinner /> : !q.data.length ? <p className="empty">Cadastre o primeiro professor para criar turmas.</p> : (
        <ul className="roster">
          {q.data.map((c) => (
            <li key={c.id} style={{ opacity: c.active ? 1 : 0.55 }}>
              <span className="coach-dot" style={{ background: c.color }} aria-hidden="true" />
              <span style={{ flex: "1 1 180px", minWidth: 0 }}><strong>{c.name}</strong>{!c.active && <span className="badge badge-off" style={{ marginLeft: 6 }}>inativo</span>}
                <br /><small className="muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "sem contato"} · {c.groups} turma(s)</small>
                <br /><small style={{ fontWeight: 700, color: c.login_email ? "var(--ok-ink)" : "var(--muted)" }}>{c.login_email ? `✓ acessa a área do professor (${c.login_email})` : "sem acesso à área do professor"}</small></span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-soft btn-sm" onClick={() => setCard(c.id)}>QR de check-in</button>
                <button className="btn btn-outline btn-sm" onClick={() => setAccess(c)}>{c.login_email ? "Acesso" : "Dar acesso"}</button>
                <button className="btn btn-outline btn-sm" onClick={() => open(c)}>Editar</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <CoachCard id={card} onClose={() => setCard(null)} />
      <CoachAccess coach={access} onClose={() => setAccess(null)} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Novo professor" : "Editar professor"} width={480}>
        <form style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <label className="field">NOME<input className="input" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">WHATSAPP<input className="input" type="tel" maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className="field">E-MAIL<input className="input" type="email" maxLength={120} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field">COR NA AGENDA<input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} style={{ width: 64, height: 40, border: 0, background: "none" }} /></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 700 }}>
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} style={{ width: 18, height: 18, accentColor: "var(--red)" }} />Ativo
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-outline" onClick={() => setEdit(null)}>Cancelar</button>
            <button className="btn btn-primary" disabled={save.isPending}>Salvar</button>
          </div>
        </form>
      </Modal>
    </Panel>
  );
}


/** Check-in do professor: QR que, lido na recepção, registra a chegada e inicia a aula. */
function CoachCard({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "coach-card", id], enabled: id !== null,
    queryFn: () => api<{ id: number; name: string; phone: string | null; token: string; groups: Group[] }>(`/api/admin/coaches/${id}/card`) });
  const c = q.data;
  const wa = c?.phone ? `https://wa.me/55${c.phone.replace(/\D/g, "").replace(/^55/, "")}?text=${encodeURIComponent(
    `🎾 *Padel Lobby · Seu QR de check-in*\n\nOlá, ${c.name.split(" ")[0]}! Ao chegar para a aula, mostre o seu QR na recepção: ele registra sua chegada e *inicia a aula* no sistema.\n\nSeu QR: ${coachQrUrl(c.token)}`)}` : null;
  return (
    <Modal open={id !== null} onClose={onClose} title="Check-in do professor" width={460}>
      {!c ? <Spinner /> : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 800 }}>{c.name}</p>
          <div style={{ border: "1px solid var(--border)", borderRadius: 20 }}><QR value={coachQrUrl(c.token)} size={190} label={`QR de check-in de ${c.name}`} /></div>
          <p className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Lido no leitor da recepção, registra a chegada e inicia a aula do horário.</p>
          <TicketActions onToast={toast} shareText={`QR de check-in do professor · Padel Lobby · ${c.name}`}
            data={{
              kind: "CHECK-IN DO PROFESSOR", title: c.name, subtitle: c.groups.length ? `${c.groups.length} turma(s) no Padel Lobby` : "Padel Lobby",
              rows: c.groups.slice(0, 3).map((g) => [g.name, `${g.schedule} · ${g.court_name}`] as [string, string]).concat(c.groups.length ? [] : [["Turmas", "—"]]),
              qr: coachQrUrl(c.token), code: "PROFESSOR", footer: "Mostre na recepção ao chegar: registra a chegada e inicia a aula.",
              filename: `checkin-professor-${c.id}.png`,
            }} />
          {wa && <a className="btn btn-outline btn-sm" href={wa} target="_blank" rel="noopener">Enviar o link pelo WhatsApp do professor</a>}
        </div>
      )}
    </Modal>
  );
}


/** Login do professor: vincula a conta do e-mail (ou cria com senha temporária) ou retira o acesso. */
function CoachAccess({ coach, onClose }: { coach: Coach | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState("");
  const [temp, setTemp] = useState<{ email: string; password: string | null } | null>(null);
  const [lastId, setLastId] = useState<number | null>(null);
  if ((coach?.id ?? null) !== lastId) { setLastId(coach?.id ?? null); setEmail(coach?.login_email ?? coach?.email ?? ""); setTemp(null); }
  const grant = useMutation({
    mutationFn: () => api<{ email: string; temporary_password: string | null }>(`/api/admin/coaches/${coach!.id}/access`, { method: "PUT", json: { email } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["admin", "coaches"] }); setTemp({ email: r.email, password: r.temporary_password }); },
    onError: (e) => toast(errMsg(e)),
  });
  const revoke = useMutation({
    mutationFn: () => api(`/api/admin/coaches/${coach!.id}/access`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "coaches"] }); toast("Acesso retirado"); onClose(); },
  });
  const link = `${location.origin}/entrar`;
  return (
    <Modal open={!!coach} onClose={onClose} title="Acesso à área do professor" width={480}>
      {coach && (temp ? (
        <div className="stack gap-14">
          <p style={{ fontSize: 15, fontWeight: 600 }}>✓ {coach.name} já pode entrar com <strong>{temp.email}</strong>.</p>
          {temp.password ? (
            <p className="alert alert-cream" style={{ padding: 14, borderRadius: 14, fontWeight: 600 }}>
              Senha temporária: <code style={{ fontSize: 18, fontWeight: 900, userSelect: "all" }}>{temp.password}</code><br />
              Passe agora — ela não aparece de novo. No primeiro acesso, o professor escolhe uma senha nova.
            </p>
          ) : <p className="muted" style={{ fontSize: 14, fontWeight: 600 }}>Essa conta já existia: o professor entra com a senha que já usa.</p>}
          {coach.phone && <a className="btn btn-primary" target="_blank" rel="noopener" href={`https://wa.me/55${coach.phone.replace(/\D/g, "").replace(/^55/, "")}?text=${encodeURIComponent(
            `🎾 *Padel Lobby · Área do professor*\n\nOlá, ${firstName(coach.name)}! Sua área está liberada: lá você vê suas aulas, faz a chamada e inicia a aula pelo celular.\n\n👉 Entre em ${link}\nE-mail: ${temp.email}${temp.password ? `\nSenha temporária: ${temp.password}` : ""}`)}`}>Enviar acesso pelo WhatsApp</a>}
          <button className="btn btn-outline" onClick={onClose}>Fechar</button>
        </div>
      ) : (
        <form className="stack gap-14" onSubmit={(e) => { e.preventDefault(); grant.mutate(); }}>
          <p className="muted" style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>O professor entra no app com este e-mail e vê só as próprias aulas: chamada, iniciar aula, anotações e alunos. Não vê valores nem cancela aulas.</p>
          <label className="field">E-MAIL DE LOGIN<input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {coach.login_email && <button type="button" className="btn btn-outline" style={{ marginRight: "auto" }} disabled={revoke.isPending}
              onClick={async () => { if (await confirm({ title: "Retirar o acesso?", message: `${coach.name} deixa de acessar a área do professor. A conta continua existindo.`, confirmLabel: "Retirar acesso", danger: true })) revoke.mutate(); }}>Retirar acesso</button>}
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" disabled={grant.isPending}>{coach.login_email ? "Atualizar acesso" : "Dar acesso"}</button>
          </div>
        </form>
      ))}
    </Modal>
  );
}
