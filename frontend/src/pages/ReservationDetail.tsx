import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Reservation } from "../api";
import { BottomNav, SiteFooter, SiteHeader, Spinner } from "../components/Layout";
import { Players } from "../components/BookingParts";
import { Back, Ball, Copy, Share } from "../components/Icons";
import { QR } from "../components/QR";
import { useToast } from "../components/Toast";
import { dayLabel, money, PAY_LABEL, STATUS_LABEL } from "../format";
import { useCountdown, useIsMobile } from "../hooks";
import { confirmCancel, inviteText, shareReservation, useCancel } from "./Reservations";

export default function ReservationDetail() {
  const { code = "" } = useParams();
  const mobile = useIsMobile();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["reservation", code],
    queryFn: () => api<Reservation>(`/api/reservations/${code}`),
    // enquanto aguarda o Pix, consulta a cada 4 s para refletir a confirmação do PSP
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 4000 : 30_000),
  });
  const r = q.data;
  const countdown = useCountdown(r?.hold_expires_at ?? null);
  const cancel = useCancel();
  const onDone = (msg: string) => (data: Reservation) => { qc.setQueryData(["reservation", code], data); qc.invalidateQueries({ queryKey: ["mine"] }); toast(msg); };
  const onErr = (e: unknown) => toast(e instanceof ApiError ? e.message : "Algo deu errado.");
  const simulate = useMutation({ mutationFn: () => api<Reservation>(`/api/reservations/${code}/pay/simulate`, { method: "POST" }), onSuccess: onDone("Pagamento confirmado!"), onError: onErr });
  const addPlayer = useMutation({ mutationFn: (name: string) => api<Reservation>(`/api/reservations/${code}/players`, { method: "POST", json: { name } }), onSuccess: onDone("Jogador adicionado"), onError: onErr });
  const removePlayer = useMutation({ mutationFn: (id: number) => api<Reservation>(`/api/reservations/${code}/players/${id}`, { method: "DELETE" }), onSuccess: onDone("Jogador removido"), onError: onErr });

  const copy = async (text: string, msg: string) => { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("Não foi possível copiar."); } };

  const body = !r ? (q.isError ? <p className="empty">Reserva não encontrada.</p> : <Spinner />) : (
    <div className="row">
      <section className="card grow-2" style={{ overflow: "hidden" }}>
        <div className="hero-m" style={{ borderRadius: 0, padding: 22 }}>
          <Ball size={140} stroke={1.4} style={{ position: "absolute", right: -40, bottom: -50 }} />
          <span className={`badge ${STATUS_LABEL[r.status]!.cls}`}>{STATUS_LABEL[r.status]!.text.toUpperCase()}</span>
          <p className="italic-title" style={{ marginTop: 10, fontSize: 30, position: "relative" }}>{r.court.name}</p>
          <p style={{ marginTop: 4, fontSize: 15, fontWeight: 600, position: "relative" }}>{dayLabel(r.date)} · {r.start}–{r.end} · {r.duration} min</p>
          <p style={{ marginTop: 6, fontSize: 13, fontWeight: 500, position: "relative" }}>Código <strong style={{ letterSpacing: 1 }}>{r.code}</strong></p>
        </div>

        {r.status === "pending" && r.pix && (
          <div style={{ padding: 22, display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
            <div style={{ border: "1px solid var(--border)", borderRadius: 20 }}>
              <QR value={r.pix.payload} size={180} label="QR code Pix para pagamento" />
            </div>
            <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 10 }}>
              <p className="italic-title" style={{ fontSize: 22 }}>Pague com Pix</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>
                Escaneie o QR code ou copie o código. A reserva confirma sozinha quando o pagamento cair.
              </p>
              {countdown && (
                <p className={`alert ${countdown.ms < 120_000 ? "alert-red" : "alert-cream"}`} aria-live="polite">
                  {countdown.ms > 0 ? <>O horário fica reservado por mais <strong>{countdown.label}</strong></> : "Prazo esgotado — o horário será liberado."}
                </p>
              )}
              <button className="btn btn-dark" onClick={() => copy(r.pix!.payload, "Código Pix copiado")}><Copy />Copiar código Pix</button>
              <button className="btn btn-outline btn-sm" disabled={simulate.isPending} onClick={() => simulate.mutate()}
                title="Ambiente de desenvolvimento: simula a confirmação do banco">Simular pagamento (teste)</button>
            </div>
          </div>
        )}

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div className="between">
              <h2 className="section-title">Jogadores</h2>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{r.players.length} de {r.max_players} · {money(r.per_player_cents)} cada</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <Players size={48} max={r.max_players}
                players={r.players.map((p) => ({ key: p.id, name: p.name, isYou: p.is_you, removable: r.is_owner && !p.is_owner && ["pending", "confirmed"].includes(r.status) }))}
                onAdd={r.is_owner && ["pending", "confirmed"].includes(r.status) ? (n) => addPlayer.mutate(n) : undefined}
                onRemove={(id) => removePlayer.mutate(Number(id))} />
            </div>
            {r.is_owner && r.invite_token && ["pending", "confirmed"].includes(r.status) && (
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-soft" onClick={() => shareReservation(r, toast)}><Share />Convidar pelo WhatsApp</button>
                <button className="btn btn-gray" onClick={() => copy(inviteText(r), "Link do convite copiado")}><Copy />Copiar link</button>
              </div>
            )}
          </div>

          <div className="price-lines">
            <div><span>Locação {r.duration} min</span><span>{money(r.price_cents)}</span></div>
            <div><span>Pagamento</span><span>{PAY_LABEL[r.payment_method]} · {{ pending: "pendente", paid: "pago", onsite: "no local", refunded: "estornado", void: "anulado" }[r.payment_status]}</span></div>
            {r.can_cancel && <div><span>Cancelamento grátis até</span><span>{new Date(r.free_cancel_until).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span></div>}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {["confirmed", "pending"].includes(r.status) && <a className="btn btn-outline" href={`/api/reservations/${r.code}/calendar.ics`}>Adicionar à agenda</a>}
            {r.can_cancel && (
              <button className="btn btn-outline" style={{ color: "var(--red-deep)" }} disabled={cancel.isPending}
                onClick={() => confirmCancel(r) && cancel.mutate(r, { onSuccess: () => q.refetch() })}>Cancelar reserva</button>
            )}
          </div>
        </div>
      </section>

      {["confirmed", "checked_in"].includes(r.status) && (
        <aside className="card grow-1" style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
          <h2 className="italic-title" style={{ fontSize: 20 }}>Check-in</h2>
          <div style={{ border: "1px solid var(--border)", borderRadius: 20 }}><QR value={r.code} size={180} label={`QR code de check-in da reserva ${r.code}`} /></div>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>Mostre na recepção ao chegar. O check-in abre 1 h antes do jogo.</p>
          {r.checked_in_at && <p className="alert alert-ok">Check-in feito às {new Date(r.checked_in_at).toLocaleTimeString("pt-BR", { timeStyle: "short" })}</p>}
        </aside>
      )}
    </div>
  );

  if (mobile) {
    return (
      <div className="has-bottom-nav">
        <header className="step-header">
          <Link to="/reservas" aria-label="Voltar" className="back"><Back /></Link>
          <div><p className="kicker">RESERVA</p><h1>{r?.status === "pending" ? "Pagamento" : "Detalhes"}</h1></div>
        </header>
        <div style={{ padding: "16px 20px 0" }}>{body}</div>
        <BottomNav />
      </div>
    );
  }
  return (
    <>
      <SiteHeader />
      <main className="container page">
        <Link to="/reservas" style={{ fontSize: 14, fontWeight: 700, textDecoration: "none" }}>← Minhas reservas</Link>
        <h1 className="italic-title" style={{ margin: "8px 0 24px", fontSize: 40 }}>{r?.status === "pending" ? <>Falta só o <span className="accent">Pix</span></> : <>Sua <span className="accent">reserva</span></>}</h1>
        {body}
      </main>
      <SiteFooter />
    </>
  );
}
