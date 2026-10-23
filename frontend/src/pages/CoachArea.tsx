import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { BottomNav, MobileHeader, SiteFooter, SiteHeader, Spinner } from "../components/Layout";
import { Modal } from "../components/Modal";
import { QR } from "../components/QR";
import { TicketActions } from "../components/Ticket";
import { useToast } from "../components/Toast";
import { coachQrUrl, dayLabel, firstName, isoDay, LEVEL_LABEL, SIDE_LABEL } from "../format";

type Session = {
  id: number; name: string; starts_at: string; ends_at: string; status: "scheduled" | "done" | "cancelled"; court_name: string;
  level: string | null; present: number; expected: number; started_at: string | null; coach_checked_in_at: string | null;
  cancel_reason: string | null; notes: string | null;
};
type Roster = { user_id: number; name: string; phone: string | null; level: string | null; status: "present" | "absent" | "justified" | null; dropin: boolean | null; checked_in_at: string | null };
type Me = {
  coach: { id: number; name: string; color: string; token: string };
  today: Session[];
  stats: { given: number; upcoming: number; presences: number; absences: number; attendance_rate: number | null };
  groups: { id: number; name: string; schedule: string; court_name: string; enrolled: number; capacity: number }[];
};
type Student = { id: number; name: string; phone: string | null; level: string | null; side: string | null; groups: string | null; presences: number; absences: number; last_class: string | null };

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const err = (e: unknown) => (e instanceof ApiError ? e.message : "Falhou.");

/** Área do professor: aulas de hoje com chamada, agenda da semana, alunos e QR de check-in. */
export default function CoachArea() {
  const { user, ready } = useAuth();
  const [qrOpen, setQrOpen] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const toast = useToast();
  const me = useQuery({ queryKey: ["coach", "me"], queryFn: () => api<Me>("/api/coach/me"), refetchInterval: 30_000, enabled: !!user?.is_coach });
  const week = useQuery({ queryKey: ["coach", "week"], queryFn: () => api<Session[]>("/api/coach/sessions?days=8"), enabled: !!user?.is_coach });
  const students = useQuery({ queryKey: ["coach", "students"], queryFn: () => api<Student[]>("/api/coach/students"), enabled: !!user?.is_coach });
  if (!ready) return <Spinner />;
  if (!user?.is_coach) return <Navigate to="/perfil" replace />;
  const d = me.data;
  const today = isoDay(new Date());
  const upcoming = (week.data ?? []).filter((s) => isoDay(new Date(s.starts_at)) > today);

  return (
    <div className="has-bottom-nav">
      <SiteHeader />
      <MobileHeader title={<>Área do <span className="accent">professor</span></>} />
      <main className="container page" style={{ maxWidth: 980 }}>
        {!d ? <Spinner /> : (
          <div className="stack gap-18">
            <section className="hero-m" style={{ padding: 22, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700 }}>Área do professor</p>
                <p className="italic-title" style={{ fontSize: 28 }}>Olá, {firstName(d.coach.name)}!</p>
                <p style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{d.today.filter((s) => s.status !== "cancelled").length ? `${d.today.filter((s) => s.status !== "cancelled").length} aula(s) hoje` : "Sem aulas hoje"}</p>
              </div>
              <button className="btn btn-white" onClick={() => setQrOpen(true)}>Meu QR de check-in</button>
            </section>

            <div className="kpis">
              <div className="kpi"><p className="label">AULAS DADAS NO MÊS</p><p className="value">{d.stats.given}</p></div>
              <div className="kpi"><p className="label">PRÓXIMAS NO MÊS</p><p className="value">{d.stats.upcoming}</p></div>
              <div className="kpi"><p className="label">FREQUÊNCIA DOS ALUNOS</p><p className="value accent">{d.stats.attendance_rate === null ? "—" : `${Math.round(d.stats.attendance_rate * 100)}%`}</p><p className="sub">{d.stats.presences} presenças no mês</p></div>
            </div>

            <section>
              <h2 className="italic-title" style={{ fontSize: 22, marginBottom: 10 }}>Hoje</h2>
              {!d.today.length ? <p className="empty card" style={{ boxShadow: "none" }}>Nenhuma aula hoje.</p>
                : <div className="stack gap-14">{d.today.map((s) => <SessionCard key={s.id} id={s.id} />)}</div>}
            </section>

            <section className="card card-pad" style={{ boxShadow: "none" }}>
              <h2 className="italic-title" style={{ fontSize: 20, marginBottom: 12 }}>Próximos dias</h2>
              {!upcoming.length ? <p className="empty">Nenhuma aula nos próximos 7 dias.</p> : (
                <ul className="class-list">
                  {upcoming.map((s) => (
                    <li key={s.id}>
                      <button type="button" className={`class-item ${s.status}`} style={{ borderLeftColor: d.coach.color }} onClick={() => setOpen(s.id)}>
                        <span className="class-time">{dayLabel(isoDay(new Date(s.starts_at)))}<small>{hhmm(s.starts_at)}</small></span>
                        <span style={{ flex: "1 1 160px", minWidth: 0 }}><strong>{s.name}</strong><br /><small className="muted">{s.court_name}{s.status === "cancelled" ? ` · cancelada: ${s.cancel_reason}` : ""}</small></span>
                        <span className="class-count"><b>{s.expected}</b><small>alunos</small></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {!!d.groups.length && (
              <section className="card card-pad" style={{ boxShadow: "none" }}>
                <h2 className="italic-title" style={{ fontSize: 20, marginBottom: 12 }}>Minhas turmas</h2>
                <div className="group-grid">
                  {d.groups.map((g) => (
                    <div key={g.id} className="group-card" style={{ borderTopColor: d.coach.color, cursor: "default" }}>
                      <strong style={{ fontSize: 16 }}>{g.name}</strong>
                      <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>{g.schedule} · {g.court_name}</span>
                      <span className="bar" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, (g.enrolled / g.capacity) * 100)}%` }} /></span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{g.enrolled}/{g.capacity} alunos</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="card card-pad" style={{ boxShadow: "none" }}>
              <h2 className="italic-title" style={{ fontSize: 20, marginBottom: 12 }}>Meus alunos</h2>
              {!students.data ? <Spinner /> : !students.data.length ? <p className="empty">Nenhum aluno ainda.</p> : (
                <ul className="roster">
                  {students.data.map((a) => {
                    const total = a.presences + a.absences;
                    return (
                      <li key={a.id}>
                        <span style={{ flex: "1 1 180px", minWidth: 0 }}>
                          <strong>{a.name}</strong>
                          <br /><small className="muted">{[a.groups ?? "avulso", a.level && LEVEL_LABEL[a.level], a.side && SIDE_LABEL[a.side]].filter(Boolean).join(" · ")}</small>
                        </span>
                        <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700 }}>
                          {total ? `${Math.round((a.presences / total) * 100)}% · ${a.presences}/${total}` : "—"}
                          <br /><small className="muted">{a.last_class ? `última: ${dayLabel(isoDay(new Date(a.last_class)))}` : "sem presença"}</small>
                        </span>
                        {a.phone && <a className="btn btn-outline btn-sm" href={`https://wa.me/55${a.phone.replace(/\D/g, "").replace(/^55/, "")}`} target="_blank" rel="noopener">WhatsApp</a>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>

      <Modal open={open !== null} onClose={() => setOpen(null)} title="Aula" width={640}>
        {open !== null && <SessionCard id={open} embedded />}
      </Modal>
      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="Meu QR de check-in" width={440}>
        {d && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
            <div style={{ border: "1px solid var(--border)", borderRadius: 20 }}><QR value={coachQrUrl(d.coach.token)} size={200} label="Seu QR de check-in de professor" /></div>
            <p className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Mostre no leitor da recepção ao chegar: registra sua chegada e inicia a aula. Ou use "Iniciar aula" aqui no app.</p>
            <TicketActions onToast={toast} shareText={`QR de check-in do professor · Padel Lobby · ${d.coach.name}`}
              data={{ kind: "CHECK-IN DO PROFESSOR", title: d.coach.name, subtitle: `${d.groups.length} turma(s) no Padel Lobby`,
                rows: d.groups.slice(0, 3).map((g) => [g.name, `${g.schedule} · ${g.court_name}`] as [string, string]).concat(d.groups.length ? [] : [["Turmas", "—"]]),
                qr: coachQrUrl(d.coach.token), code: "PROFESSOR", footer: "Mostre na recepção ao chegar: registra a chegada e inicia a aula.", filename: "checkin-professor.png" }} />
          </div>
        )}
      </Modal>
      <SiteFooter />
      <BottomNav />
    </div>
  );
}

/** Uma aula: iniciar, chamada com botões grandes, aluno avulso e anotações. */
function SessionCard({ id, embedded = false }: { id: number; embedded?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["coach", "session", id], queryFn: () => api<Session & { roster: Roster[] }>(`/api/coach/sessions/${id}`) });
  const [notes, setNotes] = useState<string | null>(null);
  const [walk, setWalk] = useState({ name: "", phone: "" });
  const [adding, setAdding] = useState(false);
  const refresh = (data: unknown) => { qc.setQueryData(["coach", "session", id], data); qc.invalidateQueries({ queryKey: ["coach", "me"] }); qc.invalidateQueries({ queryKey: ["coach", "students"] }); };
  const start = useMutation({ mutationFn: () => api(`/api/coach/sessions/${id}/start`, { method: "POST" }), onSuccess: (d) => { refresh(d); toast("Aula iniciada"); }, onError: (e) => toast(err(e)) });
  const mark = useMutation({ mutationFn: (v: { user_id: number; status: string }) => api(`/api/coach/sessions/${id}/attendance`, { method: "POST", json: v }), onSuccess: refresh, onError: (e) => toast(err(e)) });
  const save = useMutation({ mutationFn: () => api(`/api/coach/sessions/${id}/notes`, { method: "PUT", json: { notes: notes ?? "" } }), onSuccess: (d) => { refresh(d); setNotes(null); toast("Anotações salvas"); }, onError: (e) => toast(err(e)) });
  const add = useMutation({
    mutationFn: () => api(`/api/coach/sessions/${id}/students`, { method: "POST", json: { client: { name: walk.name, phone: walk.phone || null } } }),
    onSuccess: (d) => { refresh(d); setWalk({ name: "", phone: "" }); setAdding(false); toast("Aluno avulso incluído"); }, onError: (e) => toast(err(e)),
  });
  const s = q.data;
  if (!s) return <Spinner />;
  const canPresent = Date.now() >= new Date(s.starts_at).getTime() - 3600_000;
  const live = s.status !== "cancelled" && canPresent && Date.now() <= new Date(s.ends_at).getTime();
  return (
    <section className={embedded ? "" : "card card-pad"} style={embedded ? undefined : { boxShadow: "none" }}>
      <div className="between" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <p className="italic-title" style={{ fontSize: 22 }}>{hhmm(s.starts_at)} · {s.name}</p>
          <p className="muted" style={{ fontSize: 13, fontWeight: 700 }}>{dayLabel(isoDay(new Date(s.starts_at)))} · {hhmm(s.starts_at)}–{hhmm(s.ends_at)} · {s.court_name}{s.level ? ` · ${LEVEL_LABEL[s.level]}` : ""}</p>
        </div>
        {s.status === "cancelled" ? <span className="badge badge-off">Cancelada: {s.cancel_reason}</span>
          : s.started_at ? <span className="badge badge-ok">Em aula desde {hhmm(s.started_at)}</span>
          : live ? <button className="btn btn-primary" disabled={start.isPending} onClick={() => start.mutate()}>Iniciar aula</button>
          : <span className="badge badge-cream">Começa às {hhmm(s.starts_at)}</span>}
      </div>

      <h3 className="field" style={{ margin: "16px 0 8px" }}>CHAMADA · {s.present}/{s.roster.length} presentes</h3>
      {!s.roster.length ? <p className="empty">Nenhum aluno nesta aula.</p> : (
        <ul className="roster">
          {s.roster.map((r) => (
            <li key={r.user_id}>
              <span style={{ flex: "1 1 160px", minWidth: 0 }}><strong>{r.name}</strong>{r.dropin && <span className="badge badge-cream" style={{ marginLeft: 6 }}>avulso</span>}
                {r.checked_in_at && <><br /><small className="muted">chegou às {hhmm(r.checked_in_at)} (QR)</small></>}</span>
              <span className="attend big" role="group" aria-label={`Presença de ${r.name}`}>
                {([["present", "Presente"], ["absent", "Falta"], ["justified", "Justif."]] as const).map(([v, l]) => (
                  <button key={v} type="button" className={v} aria-pressed={r.status === v}
                    disabled={s.status === "cancelled" || mark.isPending || (v === "present" && !canPresent)}
                    title={v === "present" && !canPresent ? "Presença a partir de 1 h antes da aula" : undefined}
                    onClick={() => mark.mutate({ user_id: r.user_id, status: v })}>{l}</button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {s.status !== "cancelled" && canPresent && (adding ? (
        <form style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" }}
          onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <label className="field">NOME DO ALUNO AVULSO<input className="input" required minLength={2} maxLength={80} value={walk.name} onChange={(e) => setWalk({ ...walk, name: e.target.value })} /></label>
          <label className="field">WHATSAPP<input className="input" type="tel" maxLength={30} value={walk.phone} onChange={(e) => setWalk({ ...walk, phone: e.target.value })} /></label>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(false)}>Cancelar</button>
            <button className="btn btn-dark btn-sm" disabled={add.isPending}>Incluir</button>
          </div>
        </form>
      ) : <button type="button" className="btn btn-soft btn-sm" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>+ Aluno avulso</button>)}

      <label className="field" style={{ marginTop: 16 }}>ANOTAÇÕES DA AULA (CONTEÚDO, EVOLUÇÃO DOS ALUNOS)
        <textarea className="input" style={{ height: 96, padding: 12, resize: "vertical", fontWeight: 600 }} maxLength={2000}
          value={notes ?? s.notes ?? ""} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: saque e voleio de revés; Ana evoluiu na bandeja." />
      </label>
      {notes !== null && notes !== (s.notes ?? "") && (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={save.isPending} onClick={() => save.mutate()}>Salvar anotações</button>
      )}
    </section>
  );
}
