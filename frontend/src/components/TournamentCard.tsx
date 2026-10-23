import { useClub } from "../hooks";
import { Arrow, Ball } from "./Icons";

/** Calendário 2026 do torneio do clube (cartaz oficial). Para a próxima temporada, edite só esta lista. */
export const TOURNAMENT = {
  title: "Torneio Padel Lobby 2026",
  stages: [
    { name: "1ª etapa", month: "Maio", days: "13 a 17", start: "2026-05-13", end: "2026-05-17" },
    { name: "2ª etapa", month: "Julho/Agosto", days: "29/7 a 2/8", start: "2026-07-29", end: "2026-08-02" },
    { name: "3ª etapa", month: "Novembro", days: "18 a 22", start: "2026-11-18", end: "2026-11-22" },
  ],
};

type Stage = (typeof TOURNAMENT.stages)[number];
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000);

function stageStatus(s: Stage, today: string) {
  if (today > s.end) return "done" as const;
  if (today >= s.start) return "live" as const;
  return "next" as const;
}

/** Card de divulgação do torneio: destaca a próxima etapa e leva à inscrição (WhatsApp ou e-mail do clube). */
export function TournamentCard({ compact = false }: { compact?: boolean }) {
  const club = useClub().data;
  const today = club?.today ?? new Date().toISOString().slice(0, 10);
  const current = TOURNAMENT.stages.find((s) => stageStatus(s, today) !== "done");
  if (!current) return null; // temporada encerrada: o card some sozinho
  const live = stageStatus(current, today) === "live";
  const left = dayDiff(today, current.start);
  const msg = `Olá! Quero participar da ${current.name} do ${TOURNAMENT.title} (${current.days} de ${current.month.toLowerCase()}).`;
  const href = club?.whatsapp
    ? `https://wa.me/${club.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`
    : `mailto:${club?.email ?? "padellobby@gmail.com"}?subject=${encodeURIComponent(`Inscrição · ${current.name} · ${TOURNAMENT.title}`)}&body=${encodeURIComponent(msg)}`;

  return (
    <section className={`tour-card${compact ? " compact" : ""}`} aria-labelledby={compact ? "tour-t-m" : "tour-t"}>
      <Ball size={compact ? 84 : 170} stroke={1.6} style={{ position: "absolute", right: compact ? -28 : -40, top: compact ? -34 : -56, opacity: compact ? 0.45 : 0.9 }} />
      <div className="tour-head">
        <p className="tour-eyebrow">{live ? "Acontecendo agora" : left === 1 ? "Começa amanhã" : `Faltam ${left} dias`}</p>
        <h2 id={compact ? "tour-t-m" : "tour-t"} className="tour-title">{TOURNAMENT.title.replace(/ \d{4}$/, "")} <span className="year">{TOURNAMENT.title.match(/\d{4}$/)?.[0]}</span></h2>
        <p className="tour-text">
          {live ? <>A <strong>{current.name}</strong> está rolando nas nossas quadras — venha assistir!</>
            : <>Próxima: <strong>{current.name} · {current.days} de {current.month.toLowerCase()}</strong>. Garanta sua dupla.</>}
        </p>
        <a className="btn btn-ball" href={href} target="_blank" rel="noopener" aria-label={`Quero participar da ${current.name} (abre ${club?.whatsapp ? "o WhatsApp" : "o e-mail"})`}>
          Quero participar <Arrow size={16} />
        </a>
      </div>
      <ol className="tour-stages" aria-label="Calendário 2026">
        {TOURNAMENT.stages.map((s) => {
          const st = stageStatus(s, today);
          return (
            <li key={s.name} className={`tour-cal ${st}${s === current ? " current" : ""}`}>
              <span className="tour-cal-month">{s.month}</span>
              <span className="tour-cal-body">
                <b>{s.name}</b>
                <span className="tour-cal-days">{s.days}</span>
                <small>{st === "done" ? "Realizada" : st === "live" ? "Agora" : s === current ? "Próxima" : "Em breve"}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
