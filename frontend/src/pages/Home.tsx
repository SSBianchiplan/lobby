import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Availability, type CalendarDay, type Club } from "../api";
import { useAuth } from "../auth";
import { useBooking } from "../booking";
import { BottomNav, MobileHeader, SiteFooter, SiteHeader, Spinner } from "../components/Layout";
import { AiVisionCard } from "../components/AiVisionCard";
import { TournamentCard } from "../components/TournamentCard";
import { Ball } from "../components/Icons";
import { addMinutes, dayLabel, money } from "../format";
import { pickDay, useAvailability, useCalendar, useClub, useIsMobile } from "../hooks";

export default function Home() {
  const mobile = useIsMobile();
  return mobile ? <HomeMobile /> : <HomeWeb />;
}

const WD_NAMES: Record<number, string> = { 6: "Sábado", 7: "Domingo" };

export function hoursSummary(club: Club) {
  const fmt = (wd: number) => club.hours.filter((h) => h.weekday === wd).map((h) => `${h.opens}–${h.closes}`).join(" · ");
  const weekdays = [1, 2, 3, 4, 5].map(fmt);
  const rows: { label: string; value: string }[] = [];
  if (weekdays.every((w) => w === weekdays[0])) rows.push({ label: "Seg a Sex", value: weekdays[0] || "Fechado" });
  else ["Seg", "Ter", "Qua", "Qui", "Sex"].forEach((l, i) => rows.push({ label: l, value: weekdays[i] || "Fechado" }));
  for (const wd of [6, 7]) rows.push({ label: WD_NAMES[wd]!, value: fmt(wd) || "Fechado" });
  return rows;
}

/** Horários (início) em que pelo menos uma quadra está livre, com a primeira quadra livre. */
function freeTimes(av?: Availability) {
  if (!av) return [];
  return av.rows.flatMap((r) => {
    const slot = r.slots.find((s) => s.status === "free");
    return slot ? [{ time: r.time, courtId: slot.court_id, price: slot.price_cents }] : [];
  });
}

// ── Web 01 · Início ────────────────────────────────────────────────────────

function HomeWeb() {
  const club = useClub().data;
  const cal = useCalendar(7);
  const { draft, update } = useBooking();
  const navigate = useNavigate();
  const date = pickDay(cal.data, draft.date);
  const av = useAvailability(date, draft.duration);
  const times = freeTimes(av.data);
  const sel = times.find((t) => t.time === draft.start && t.courtId === draft.courtId);
  const court = av.data?.courts.find((c) => c.id === sel?.courtId);
  const isToday = date === club?.today;

  return (
    <>
      <SiteHeader />
      <main style={{ flex: 1 }}>
        <section className="container" style={{ paddingTop: 32, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24, alignItems: "stretch" }}>
          <div className="hero" style={{ padding: "48px 44px", display: "flex", flexDirection: "column", justifyContent: "flex-end", minHeight: 440 }}>
            <Ball size={260} stroke={1.4} style={{ position: "absolute", right: -60, top: -60 }} />
            <Ball size={90} style={{ position: "absolute", right: 150, top: 150 }} />
            <p style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1, position: "relative" }}>RIO GRANDE · RS</p>
            <h1 style={{ marginTop: 10, fontSize: 56, lineHeight: 1, fontWeight: 900, fontStyle: "italic", maxWidth: 520, position: "relative" }}>Sua quadra de padel no centro da cidade</h1>
            <p style={{ marginTop: 16, fontSize: 17, lineHeight: 1.5, fontWeight: 500, maxWidth: 460, position: "relative" }}>
              {club?.courts.length ?? 3} quadras de padel sintético cobertas, com bar, churrasqueira e vestiário. Reserve online em segundos.
            </p>
            {club && (
              <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap", position: "relative" }}>
                {hoursSummary(club).filter((h) => h.value !== "Fechado").map((h) => (
                  <span key={h.label} className="pill-light">{h.label.replace("Sábado", "Sáb").replace(" a ", "–")} {h.value.replace(/:00/g, "h").replace(/–/g, " às ")}</span>
                ))}
              </div>
            )}
          </div>

          <form aria-label="Reserva rápida" className="card" style={{ borderRadius: 28, padding: 32, boxShadow: "var(--shadow-float)", display: "flex", flexDirection: "column", gap: 18 }}
            onSubmit={(e) => { e.preventDefault(); if (sel) { update({ date, courtId: sel.courtId, start: sel.time }); navigate("/agenda"); } }}>
            <h2 className="italic-title" style={{ fontSize: 26 }}>Reserve agora</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <label className="field">DATA
                <select className="select" value={date ?? ""} onChange={(e) => update({ date: e.target.value, start: null, courtId: null })}>
                  {cal.data?.map((d) => (
                    <option key={d.date} value={d.date} disabled={!d.open}>
                      {d.date === club?.today ? `Hoje, ${dayLabel(d.date).toLowerCase()}` : dayLabel(d.date)}{d.holiday ? ` · ${d.holiday}` : ""}{!d.open ? " · fechado" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">DURAÇÃO
                <select className="select" value={draft.duration} onChange={(e) => update({ duration: Number(e.target.value), start: null, courtId: null })}>
                  {(club?.durations ?? [60, 90]).map((d) => <option key={d} value={d}>{d} min</option>)}
                </select>
              </label>
            </div>
            <div>
              <p className="eyebrow" style={{ marginBottom: 8, fontWeight: 700 }}>HORÁRIOS LIVRES {isToday ? "HOJE" : date ? dayLabel(date).toUpperCase() : ""}</p>
              {av.isLoading ? <Spinner /> : times.length === 0 ? (
                <p className="alert alert-cream">Sem horários livres nesse dia. Escolha outra data.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 8 }}>
                  {times.map((t) => (
                    <button key={t.time} type="button" className="slot" style={{ height: 48, borderRadius: 14 }}
                      aria-pressed={sel?.time === t.time}
                      onClick={() => update({ date, start: t.time, courtId: t.courtId })}>{t.time}</button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                  {sel && court ? `${court.name} · ${sel.time}–${addMinutes(sel.time, draft.duration)}` : "Escolha um horário"}
                </p>
                <p className="italic-title accent" style={{ marginTop: 2, fontSize: 24 }}>{sel ? money(sel.price) : "R$ —"}</p>
              </div>
              <button type="submit" className="btn btn-primary btn-lg" disabled={!sel}>Continuar reserva</button>
            </div>
          </form>
        </section>

        <div className="container" style={{ paddingTop: 32 }}><TournamentCard /></div>
        <div className="container" style={{ paddingTop: 24 }}><AiVisionCard /></div>

        <section aria-labelledby="estrutura-t" id="estrutura" className="container" style={{ paddingTop: 56 }}>
          <h2 id="estrutura-t" className="italic-title" style={{ fontSize: 32 }}>Estrutura <span className="accent">completa</span></h2>
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <div className="card" style={{ borderRadius: 22, overflow: "hidden", boxShadow: "none" }}>
              <div className="photo-ph">[FOTO DA QUADRA 1]</div>
              <p style={{ padding: "16px 18px", fontSize: 16, fontWeight: 800 }}>{club?.courts.length ?? 3} quadras cobertas <span style={{ fontWeight: 500, color: "var(--muted)" }}>· piso sintético</span></p>
            </div>
            <div className="card" style={{ borderRadius: 22, overflow: "hidden", boxShadow: "none" }}>
              <div className="photo-ph">[FOTO DA QUADRA 2]</div>
              <p style={{ padding: "16px 18px", fontSize: 16, fontWeight: 800 }}>Iluminação para jogo noturno</p>
            </div>
            <div className="card" style={{ borderRadius: 22, padding: 22, boxShadow: "none", display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 16, fontWeight: 800 }}>Comodidades</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 14, fontWeight: 600 }}>
                {club?.amenities.map((a) => <li key={a} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--cream)" }}>{a}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="visite" className="container" style={{ paddingTop: 56, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <div className="card" id="promocoes" style={{ borderRadius: 22, padding: 26, boxShadow: "none" }}>
            <h2 id="visite" className="italic-title" style={{ fontSize: 22 }}>Horário de funcionamento</h2>
            {club && (
              <dl style={{ margin: "14px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 24px", fontSize: 15 }}>
                {hoursSummary(club).map((h) => (
                  <FragmentRow key={h.label} label={h.label} value={h.value} />
                ))}
              </dl>
            )}
            <p className="alert alert-red" style={{ marginTop: 18 }}>Sábado, domingo e feriados: promoção vale para todos os horários.</p>
            {club && <PriceTable club={club} />}
          </div>
          <div className="card" style={{ borderRadius: 22, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "none" }}>
            {club && <iframe className="map" title="Mapa do Padel Lobby" height={180} loading="lazy"
              src={`https://www.google.com/maps?q=${encodeURIComponent(`${club.address}, Rio Grande, RS`)}&output=embed`} />}
            <div style={{ padding: "20px 26px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 16, fontWeight: 800 }}>{club?.address}</p>
                <p style={{ marginTop: 2, fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>{club?.district}</p>
              </div>
              <a href={club?.maps_url} target="_blank" rel="noreferrer" className="btn btn-soft">Como chegar</a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ fontWeight: 800 }}>{label}</dt>
      <dd style={{ margin: 0, color: "var(--muted)", fontWeight: 600 }}>{value}</dd>
    </>
  );
}

function PriceTable({ club }: { club: Club }) {
  if (!club.prices.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <p className="eyebrow">VALORES POR HORA</p>
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 600 }}>
        {club.prices.map((p) => (
          <li key={p.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{p.label}{p.starts !== "00:00" ? ` · ${p.starts}–${p.ends === "23:59" ? "fechamento" : p.ends}` : ""}</span>
            <strong>{money(p.cents_per_hour)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 01 · Início (mobile) ───────────────────────────────────────────────────

function HomeMobile() {
  const { user } = useAuth();
  const club = useClub().data;
  const cal = useCalendar(7);
  const { draft, update } = useBooking();
  const navigate = useNavigate();
  const date = pickDay(cal.data, draft.date);
  const av = useAvailability(date, 60);
  const nextOpen = useMemo(() => cal.data?.find((d) => d.date > (date ?? "") && d.open && d.free > 0), [cal.data, date]);
  const isToday = date === club?.today;

  const go = (courtId: number, time: string, day = date) => {
    update({ date: day, courtId, start: time, duration: 60 });
    navigate("/agenda");
  };

  return (
    <div className="has-bottom-nav">
      <MobileHeader />
      <section className="hero-m" style={{ margin: "16px 20px 0", padding: 20 }}>
        <Ball size={120} stroke={1.6} style={{ position: "absolute", right: -26, top: -22, opacity: 0.95 }} />
        <p style={{ fontSize: 13, fontWeight: 700 }}>Olá{user ? `, ${user.name.split(" ")[0]}` : "!"}</p>
        <h1 style={{ marginTop: 4, fontSize: 30, lineHeight: 1.05, fontWeight: 900, fontStyle: "italic", maxWidth: 240 }}>Reserve sua quadra</h1>
        <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.4, fontWeight: 500, maxWidth: 260 }}>
          {club?.courts.length ?? 3} quadras de padel sintético, cobertas. Centro de Rio Grande.
        </p>
      </section>

      <section aria-label="Escolha o dia" style={{ marginTop: 16, padding: "0 20px" }}>
        <DayButtons days={cal.data?.slice(0, 5)} value={date} today={club?.today} onChange={(d) => update({ date: d, start: null, courtId: null })} />
      </section>

      <section style={{ marginTop: 20, padding: "0 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, fontStyle: "italic", color: "var(--muted)" }}>LIVRES {isToday ? "HOJE" : date ? dayLabel(date).toUpperCase() : ""}</h2>
          <Link to="/agenda" style={{ fontSize: 13, fontWeight: 700, textDecoration: "none" }}>Ver agenda</Link>
        </div>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {av.isLoading && <Spinner />}
          {av.data && !av.data.open && <p className="alert alert-cream">Fechado nesse dia{av.data.holiday ? ` (${av.data.holiday})` : ""}.</p>}
          {av.data?.open && av.data.courts.map((c) => {
            const free = av.data!.rows.flatMap((r) => r.slots.filter((s) => s.court_id === c.id && s.status === "free").map(() => r.time));
            return (
              <div key={c.id} className="card" style={{ borderRadius: 18, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 50, height: 50, borderRadius: 25, background: free.length ? "var(--ball)" : "var(--off-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, fontStyle: "italic", color: free.length ? "var(--ink)" : "var(--muted)", flex: "none" }}>{c.number}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 800 }}>{c.name} <span style={{ fontWeight: 500, color: "var(--muted)" }}>· {c.description}</span></p>
                  {free.length ? (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {free.slice(0, 4).map((t) => (
                        <button key={t} className="time-chip" onClick={() => go(c.id, t)} aria-label={`${c.name} às ${t}`}>{t}</button>
                      ))}
                    </div>
                  ) : (
                    <NextFree courtId={c.id} next={nextOpen} label={isToday ? "Lotada hoje" : "Lotada"} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div style={{ margin: "16px 20px 0" }}><TournamentCard compact /></div>
      {club && (
        <section className="promo-strip" style={{ margin: "12px 20px 0" }}>
          <Ball size={26} />
          <p><strong>Promoção:</strong> {club.promo_text}</p>
        </section>
      )}
      <div style={{ margin: "16px 20px 0" }}><AiVisionCard compact /></div>
      <BottomNav />
    </div>
  );
}

function NextFree({ courtId, next, label }: { courtId: number; next?: CalendarDay; label: string }) {
  const q = useQuery({
    queryKey: ["availability", next?.date, 60],
    queryFn: () => api<Availability>(`/api/availability?date=${next!.date}&duration=60`),
    enabled: !!next,
  });
  const row = q.data?.rows.find((r) => r.slots.some((s) => s.court_id === courtId && s.status === "free"));
  return (
    <p style={{ marginTop: 6, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>
      {label}{row && next ? ` · próximo livre ${next.weekday.toLowerCase()} ${row.time}` : ""}
    </p>
  );
}

export function DayButtons({ days, value, today, onChange }: { days?: CalendarDay[]; value: string | null; today?: string; onChange: (d: string) => void }) {
  return (
    <div className="days">
      {days?.map((d) => (
        <button key={d.date} className="day-btn" disabled={!d.open} aria-pressed={d.date === value}
          aria-label={`${d.weekday} ${d.day}${d.holiday ? `, ${d.holiday}` : ""}${!d.open ? ", fechado" : ""}`}
          title={d.holiday ?? undefined}
          onClick={() => onChange(d.date)}>
          <span className="wd">{d.date === today ? "HOJE" : d.weekday}</span>
          <span className="num">{d.day}</span>
        </button>
      ))}
    </div>
  );
}
