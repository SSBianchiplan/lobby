
import { Link, useNavigate } from "react-router-dom";
import type { Availability, Slot } from "../api";
import { useAuth } from "../auth";
import { useBooking } from "../booking";
import { Ball, Back, CalendarIcon, ChevronDown, Arrow } from "../components/Icons";
import { SiteFooter, SiteHeader, Spinner } from "../components/Layout";
import { PaymentOptions, PriceLines, Players } from "../components/BookingParts";
import { addMinutes, dayLabel, dayLong, money } from "../format";
import { pickDay, useAvailability, useCalendar, useClub, useIsMobile } from "../hooks";
import { hoursSummary } from "./Home";
import { useCreateReservation, useQuote } from "./useCreate";

export default function Agenda() {
  return useIsMobile() ? <AgendaMobile /> : <AgendaWeb />;
}

function useAgenda() {
  const { draft, update } = useBooking();
  const club = useClub().data;
  const cal = useCalendar(club?.booking_horizon_days ? Math.min(club.booking_horizon_days, 14) : 7);
  const date = pickDay(cal.data, draft.date);
  const av = useAvailability(date, draft.duration);
  const selected = !!(draft.start && draft.courtId && draft.date === date);
  const selSlot = selected ? av.data?.rows.find((r) => r.time === draft.start)?.slots.find((s) => s.court_id === draft.courtId) : undefined;
  // seleção que ficou ocupada/indisponível some sozinha
  const valid = selected && selSlot?.status === "free";
  return { draft, update, club, cal, date, av, valid };
}

function Duration({ value, options, onChange, small }: { value: number; options: number[]; onChange: (d: number) => void; small?: boolean }) {
  return (
    <div role="group" aria-label="Duração" className={`segmented${small ? " sm" : ""}`}>
      {options.map((d) => <button key={d} aria-pressed={value === d} onClick={() => onChange(d)}>{d} min</button>)}
    </div>
  );
}

function SlotCell({ slot, selected, onPick, label }: { slot: Slot; selected: boolean; onPick: () => void; label: string }) {
  if (slot.status === "free")
    return <button className="slot" aria-pressed={selected} aria-label={label} onClick={onPick}>{selected ? "Selecionado" : "Livre"}</button>;
  if (slot.status === "busy") return <span className={`slot-off${slot.mine ? " mine" : ""}`}>{slot.mine ? "Sua reserva" : "Ocupado"}</span>;
  if (slot.status === "blocked") return <span className="slot-off">Bloqueado</span>;
  if (slot.status === "past") return <span className="slot-off past">Encerrado</span>;
  return <span className="slot-off past">—</span>;
}

// ── Web 02 · Agenda e reserva ──────────────────────────────────────────────

function AgendaWeb() {
  const { draft, update, club, cal, date, av, valid } = useAgenda();
  const { user } = useAuth();
  const quote = useQuote();
  const create = useCreateReservation("/agenda");
  const court = av.data?.courts.find((c) => c.id === draft.courtId);
  const players = [{ key: "me", name: user?.name ?? "Você", isYou: true }, ...draft.guests.map((g, i) => ({ key: i, name: g, removable: true }))];

  return (
    <>
      <SiteHeader cta={user ? undefined : <Link to="/entrar?next=/agenda" className="btn btn-primary">Entrar</Link>} />
      <main className="container page">
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 800, color: "var(--red)" }}>PASSO 1 DE 2</p>
            <h1 className="italic-title" style={{ marginTop: 4, fontSize: 40, lineHeight: 1.05 }}>Escolha quadra e horário</h1>
          </div>
          <Duration value={draft.duration} options={club?.durations ?? [60, 90]} onChange={(d) => update({ duration: d, start: null, courtId: null })} />
        </div>

        <div role="tablist" aria-label="Dia" className="day-tabs" style={{ marginTop: 20 }}>
          {cal.data?.slice(0, 7).map((d) => (
            <button key={d.date} role="tab" className="day-tab" aria-selected={d.date === date} disabled={!d.open}
              title={d.holiday ?? undefined} onClick={() => update({ date: d.date, start: null, courtId: null })}>
              {d.date === club?.today ? "Hoje" : d.weekday.charAt(0) + d.weekday.slice(1).toLowerCase()} · {d.day}
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 24 }}>
          <section aria-label="Grade de horários" className="card grow-2" style={{ padding: 20, boxShadow: "0 2px 10px rgba(43,43,43,0.05)" }}>
            {av.data?.holiday && <p className="alert alert-cream" style={{ margin: "0 8px 8px" }}>Feriado: {av.data.holiday} · preço promocional o dia todo.</p>}
            <Grid av={av.data} loading={av.isLoading} selected={valid ? { time: draft.start!, court: draft.courtId! } : null}
              onPick={(time, courtId) => update({ date, start: time, courtId })} />
          </section>

          <aside aria-label="Resumo da reserva" className="card grow-1" style={{ overflow: "hidden", boxShadow: "var(--shadow-float)" }}>
            <div style={{ padding: 22, background: "var(--grad-hero-web)", color: "#fff" }}>
              <p style={{ fontSize: 12, fontWeight: 800 }}>SUA RESERVA</p>
              <p className="italic-title" style={{ marginTop: 6, fontSize: 26 }}>{valid && court ? court.name : "Escolha um horário"}</p>
              <p style={{ marginTop: 4, fontSize: 15, fontWeight: 600 }}>
                {valid && date ? `${dayLabel(date)} · ${draft.start}–${addMinutes(draft.start!, draft.duration)}` : "Clique em um horário livre na grade"}
              </p>
            </div>
            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <p className="eyebrow">JOGADORES · {players.length} DE {club?.max_players ?? 4}</p>
                <div style={{ marginTop: 10 }}>
                  <Players players={players} max={club?.max_players ?? 4}
                    onAdd={(n) => update({ guests: [...draft.guests, n] })}
                    onRemove={(k) => update({ guests: draft.guests.filter((_, i) => i !== k) })} />
                </div>
              </div>
              <div>
                <p className="eyebrow" style={{ marginBottom: 10 }}>PAGAMENTO</p>
                <PaymentOptions name="pgw" value={draft.method} onChange={(m) => update({ method: m })} />
              </div>
              {valid && <PriceLines quote={quote.data} duration={draft.duration} players={players.length} />}
              <button className="btn btn-primary btn-lg btn-split" disabled={!valid || create.isPending} onClick={create.submit}>
                <span>{create.isPending ? "Reservando…" : user ? "Confirmar" : "Entrar e confirmar"}</span>
                <span style={{ fontStyle: "italic" }}>{valid && quote.data ? money(quote.data.cents) : ""}</span>
              </button>
              <p style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", textAlign: "center" }}>
                Cancelamento grátis até {club?.cancel_free_hours ?? "—"} h antes. <Link to="/perfil#politica">Política</Link>
              </p>
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Grid({ av, loading, selected, onPick }: {
  av?: Availability; loading: boolean; selected: { time: string; court: number } | null; onPick: (time: string, court: number) => void;
}) {
  if (loading || !av) return <Spinner />;
  if (!av.open) return <p className="empty">Fechado nesse dia{av.holiday ? ` (${av.holiday})` : ""}.</p>;
  return (
    <div className="table-scroll">
      <table className="grid-table">
        <thead>
          <tr>
            <th scope="col" style={{ width: 80, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>HORA</th>
            {av.courts.map((c) => <th key={c.id} scope="col" className="italic-title" style={{ fontSize: 15 }}>{c.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {av.rows.map((r) => (
            <tr key={r.time}>
              <th scope="row" style={{ fontWeight: 800, color: r.break ? "var(--muted)" : undefined }}>{r.time}</th>
              {r.break ? (
                <td colSpan={av.courts.length}><span className="slot-break">Intervalo · {r.time}–{r.until}</span></td>
              ) : (
                r.slots.map((s) => {
                  const c = av.courts.find((x) => x.id === s.court_id)!;
                  return (
                    <td key={s.court_id}>
                      <SlotCell slot={s} selected={selected?.time === r.time && selected.court === s.court_id}
                        label={`${c.name} às ${r.time}, ${money(s.price_cents)}`} onPick={() => onPick(r.time, s.court_id)} />
                    </td>
                  );
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 02 · Escolher horário (mobile) ─────────────────────────────────────────

function AgendaMobile() {
  const { draft, update, club, cal, date, av, valid } = useAgenda();
  const navigate = useNavigate();
  const quote = useQuote();
  const courtId = draft.courtId ?? av.data?.courts[0]?.id ?? null;
  const court = av.data?.courts.find((c) => c.id === courtId);

  return (
    <div className="has-footer-bar">
      <header className="step-header">
        <Link to="/" aria-label="Voltar" className="back"><Back /></Link>
        <div>
          <p className="kicker">PASSO 1 DE 2</p>
          <h1>Escolha o horário</h1>
        </div>
      </header>

      <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <label className="btn btn-outline" style={{ height: 44, padding: "0 14px", borderRadius: 22, fontSize: 14, position: "relative", gap: 8 }}>
          <CalendarIcon size={18} style={{ color: "var(--red)" }} />
          {date ? dayLong(date) : "Data"}
          <ChevronDown />
          <select aria-label="Data" value={date ?? ""} onChange={(e) => update({ date: e.target.value, start: null })}
            style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", cursor: "pointer" }}>
            {cal.data?.map((d) => (
              <option key={d.date} value={d.date} disabled={!d.open}>{dayLong(d.date)}{d.holiday ? ` · ${d.holiday}` : ""}{!d.open ? " · fechado" : ""}</option>
            ))}
          </select>
        </label>
        <Duration small value={draft.duration} options={club?.durations ?? [60, 90]} onChange={(d) => update({ duration: d, start: null })} />
      </div>

      <div role="tablist" aria-label="Quadra" className="court-tabs" style={{ margin: "14px 20px 0" }}>
        {av.data?.courts.map((c) => (
          <button key={c.id} role="tab" className="court-tab" aria-selected={c.id === courtId}
            onClick={() => update({ courtId: c.id, start: draft.courtId === c.id ? draft.start : null })}>
            {c.id === courtId && <Ball size={16} stroke={2.5} />}{c.name}
          </button>
        ))}
      </div>

      <div className="legend" style={{ padding: "14px 20px 0" }}>
        <span><i style={{ background: "#fff", border: "1px solid var(--border-strong)" }} />Livre</span>
        <span><i style={{ background: "var(--red)" }} />Selecionado</span>
        <span><i style={{ background: "var(--border)" }} />Ocupado</span>
      </div>

      <section aria-label="Horários" style={{ padding: "12px 20px 0" }}>
        {av.isLoading && <Spinner />}
        {av.data && !av.data.open && <p className="alert alert-cream">Fechado nesse dia{av.data.holiday ? ` (${av.data.holiday})` : ""}.</p>}
        {av.data?.open && (
          <div className="slot-grid">
            {av.data.rows.map((r) => {
              if (r.break) return <div key={r.time} className="slot-break">{r.time}–{r.until} · intervalo</div>;
              const s = r.slots.find((x) => x.court_id === courtId);
              if (!s) return null;
              const sel = valid && draft.start === r.time && draft.courtId === courtId;
              return s.status === "free" ? (
                <button key={r.time} className="slot" aria-pressed={sel} onClick={() => update({ date, courtId, start: r.time })}>{r.time}</button>
              ) : (
                <button key={r.time} className={`slot-off busy${s.mine ? " mine" : ""}`} disabled style={{ border: 0 }}
                  aria-label={`${r.time} indisponível`}>{r.time}</button>
              );
            })}
          </div>
        )}
        {club && <p style={{ marginTop: 12, fontSize: 12, lineHeight: 1.4, fontWeight: 500, color: "var(--muted)" }}>
          {hoursSummary(club).map((h) => `${h.label} ${h.value}`).join(" · ")}
        </p>}
      </section>

      <footer className="footer-bar" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
            {valid && court && date ? `${court.name} · ${dayLabel(date).toLowerCase()} · ${draft.start}–${addMinutes(draft.start!, draft.duration)}` : "Escolha um horário livre"}
          </p>
          <p className="italic-title accent" style={{ marginTop: 2, fontSize: 22 }}>{valid && quote.data ? money(quote.data.cents) : "R$ —"}</p>
        </div>
        <button className="btn btn-primary btn-lg" disabled={!valid} onClick={() => navigate("/agenda/confirmar")}>Continuar <Arrow /></button>
      </footer>
    </div>
  );
}

