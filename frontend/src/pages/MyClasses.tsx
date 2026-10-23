import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { QR } from "../components/QR";
import { shareTicket, TicketActions } from "../components/Ticket";
import { useToast } from "../components/Toast";
import { coachLabel, dayLabel, isoDay, money, studentQrUrl } from "../format";

type Mine = {
  groups: { id: number; name: string; schedule: string; coach_name: string; court_name: string }[];
  upcoming: { id: number; name: string; starts_at: string; ends_at: string; court_name: string; coach_name: string }[];
  history: { name: string; starts_at: string; status: "present" | "absent" | "justified" }[];
  attendance_rate: number | null;
  open_charges: { id: number; description: string; amount_cents: number }[];
  checkin_token: string;
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const STATUS = { present: "Presente", absent: "Falta", justified: "Justificada" } as const;

/** Área do aluno no perfil: turmas, próximas aulas, frequência, mensalidades em aberto e QR de check-in. */
export default function MyClasses() {
  const { user } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ["me", "classes"], queryFn: () => api<Mine>("/api/me/classes") });
  const d = q.data;
  if (!d) return null;
  const isStudent = d.groups.length > 0 || d.upcoming.length > 0 || d.history.length > 0;
  return (
    <section id="aulas" className="card card-pad" style={{ marginTop: 16, boxShadow: "none", scrollMarginTop: 90 }}>
      <h2 className="italic-title" style={{ fontSize: 20, marginBottom: 14 }}>Minhas aulas</h2>
      {!isStudent ? (
        <p className="muted" style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>
          Você ainda não está em nenhuma turma. Quer aprender ou evoluir no padel? Fale com a recepção para conhecer as turmas e as aulas particulares.
        </p>
      ) : (
        <div className="my-classes">
          <div className="stack gap-14" style={{ flex: "1 1 300px", minWidth: 0 }}>
            {d.groups.map((g) => (
              <div key={g.id} style={{ padding: "12px 14px", borderRadius: 14, background: "var(--bg)" }}>
                <strong>{g.name}</strong><br />
                <small className="muted" style={{ fontWeight: 600 }}>{g.schedule} · {g.court_name} · {coachLabel(g.coach_name)}</small>
              </div>
            ))}
            {!!d.upcoming.length && (
              <div>
                <p className="field" style={{ marginBottom: 6 }}>PRÓXIMAS AULAS</p>
                <ul className="roster">
                  {d.upcoming.map((u) => (
                    <li key={u.id}>
                      <span className="class-time" style={{ width: 70 }}>{dayLabel(isoDay(new Date(u.starts_at)))}<small>{hhmm(u.starts_at)}</small></span>
                      <span style={{ flex: 1, minWidth: 0 }}><strong>{u.name}</strong><br /><small className="muted">{u.court_name} · {coachLabel(u.coach_name)}</small></span>
                      <button type="button" className="btn btn-soft btn-sm" onClick={() => shareTicket({
                        kind: "CHECK-IN DA AULA", title: u.name, subtitle: `${dayLabel(isoDay(new Date(u.starts_at)))} · ${hhmm(u.starts_at)}–${hhmm(u.ends_at)}`, status: "MARCADA",
                        rows: [["Aluno", user?.name ?? ""], ["Professor", u.coach_name], ["Quadra", `${u.court_name} · Padel Lobby`]],
                        qr: studentQrUrl(d.checkin_token), code: "ALUNO", footer: "Apresente na recepção ao chegar: sua presença é registrada na hora.",
                        filename: `checkin-aula-${isoDay(new Date(u.starts_at))}.png`,
                      }, `Minha aula no Padel Lobby: ${u.name}, ${dayLabel(isoDay(new Date(u.starts_at)))} às ${hhmm(u.starts_at)}.`, true, toast)}>Check-in</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.attendance_rate !== null && (
              <p style={{ fontSize: 14, fontWeight: 700 }}>Frequência recente: {Math.round(d.attendance_rate * 100)}%
                <span className="muted" style={{ fontWeight: 600 }}> · {d.history.slice(0, 5).map((h) => `${dayLabel(isoDay(new Date(h.starts_at)))} ${STATUS[h.status]}`).join(" · ")}</span></p>
            )}
            {!!d.open_charges.length && (
              <p className="alert alert-red" style={{ padding: 12, borderRadius: 12, fontSize: 14, fontWeight: 700 }}>
                Em aberto: {d.open_charges.map((c) => `${c.description} (${money(c.amount_cents)})`).join(" · ")}. Pague na recepção.
              </p>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: "1 1 220px", minWidth: 0, maxWidth: "100%" }}>
            <div style={{ border: "1px solid var(--border)", borderRadius: 20 }}><QR value={studentQrUrl(d.checkin_token)} size={150} label="Seu QR code de aluno para check-in nas aulas" /></div>
            <small className="muted" style={{ fontWeight: 700, textAlign: "center", maxWidth: 180 }}>Mostre na recepção ao chegar para a aula</small>
            <TicketActions compact onToast={toast} shareText="Meu QR de check-in de aluno do Padel Lobby."
              data={{
                kind: "CHECK-IN DO ALUNO", title: user?.name ?? "Aluno", subtitle: d.groups.map((g) => g.name).join(" · ") || "Aulas particulares",
                rows: d.groups.slice(0, 3).map((g) => [g.name, `${g.schedule} · ${g.court_name}`] as [string, string]).concat([["Professor", [...new Set(d.groups.map((g) => g.coach_name))].join(", ") || "—"]]),
                qr: studentQrUrl(d.checkin_token), code: "ALUNO", footer: "Apresente na recepção para registrar sua presença na aula.",
                filename: "checkin-aluno-padel-lobby.png",
              }} />
          </div>
        </div>
      )}
    </section>
  );
}
