import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useBooking } from "../booking";
import { PaymentOptions, PriceLines, Players } from "../components/BookingParts";
import { Back, Ball } from "../components/Icons";
import { dayLabel, money } from "../format";
import { useAvailability, useClub, useIsMobile } from "../hooks";
import { useCreateReservation, useQuote } from "./useCreate";

// 03 · Confirmar e pagar (mobile). No desktop a confirmação fica no resumo lateral da agenda.
export default function Confirm() {
  const mobile = useIsMobile();
  const { draft, update } = useBooking();
  const { user } = useAuth();
  const club = useClub().data;
  const av = useAvailability(draft.date, draft.duration);
  const quote = useQuote();
  const create = useCreateReservation("/agenda/confirmar");

  if (!mobile) return <Navigate to="/agenda" replace />;
  if ((!draft.date || !draft.start || !draft.courtId) && !create.isSuccess) return <Navigate to="/agenda" replace />;
  if (!draft.date || !draft.start || !draft.courtId) return null;
  const court = av.data?.courts.find((c) => c.id === draft.courtId);
  const max = club?.max_players ?? 4;
  const players = [{ key: "me", name: user?.name ?? "Você", isYou: true }, ...draft.guests.map((g, i) => ({ key: i, name: g, removable: true }))];

  return (
    <div style={{ paddingBottom: 140 }}>
      <header className="step-header">
        <Link to="/agenda" aria-label="Voltar" className="back"><Back /></Link>
        <div>
          <p className="kicker">PASSO 2 DE 2</p>
          <h1>Confirme e pague</h1>
        </div>
      </header>

      <section aria-label="Resumo" className="card" style={{ margin: "16px 20px 0", borderRadius: 20, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <Ball size={40} />
          <div style={{ flex: 1 }}>
            <p className="italic-title" style={{ fontSize: 18 }}>{court?.name ?? "Quadra"}</p>
            <p style={{ marginTop: 2, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>Padel sintético · {court?.description ?? "coberta"}</p>
          </div>
          <Link to="/agenda" style={{ fontSize: 13, fontWeight: 700, textDecoration: "none", padding: "12px 0" }}>Alterar</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "var(--pink)" }}>
          {[["DATA", dayLabel(draft.date)], ["INÍCIO", draft.start], ["DURAÇÃO", `${draft.duration} min`]].map(([k, v]) => (
            <div key={k} style={{ padding: "10px 16px" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>{k}</p>
              <p style={{ marginTop: 2, fontSize: 15, fontWeight: 800, color: "var(--red-deep)" }}>{v}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ margin: "18px 20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="section-title">Jogadores</h2>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{players.length} de {max}</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <Players size={48} players={players} max={max}
            onAdd={(n) => update({ guests: [...draft.guests, n] })}
            onRemove={(k) => update({ guests: draft.guests.filter((_, i) => i !== k) })} />
        </div>
        <p style={{ marginTop: 6, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>Convide pelo WhatsApp e divida o valor.</p>
      </section>

      <section style={{ margin: "16px 20px 0" }}>
        <h2 className="section-title">Pagamento</h2>
        <div style={{ marginTop: 10 }}>
          <PaymentOptions value={draft.method} onChange={(m) => update({ method: m })} />
        </div>
      </section>

      <section style={{ margin: "12px 20px 0" }}>
        <PriceLines quote={quote.data} duration={draft.duration} players={players.length} />
      </section>

      <footer className="footer-bar" style={{ padding: "14px 20px calc(18px + env(safe-area-inset-bottom))" }}>
        <button className="btn btn-primary btn-lg btn-block btn-split" disabled={create.isPending || !quote.data} onClick={create.submit}>
          <span>{create.isPending ? "Reservando…" : "Confirmar reserva"}</span>
          <span style={{ fontStyle: "italic" }}>{quote.data ? money(quote.data.cents) : ""}</span>
        </button>
        <p style={{ marginTop: 8, fontSize: 11, fontWeight: 500, lineHeight: 1.4, color: "var(--muted)", textAlign: "center" }}>
          Cancelamento grátis até {club?.cancel_free_hours ?? "—"} h antes. <Link to="/perfil#politica">Política</Link>
        </p>
      </footer>
    </div>
  );
}
