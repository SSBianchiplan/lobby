import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Reservation } from "../api";
import { useBooking } from "../booking";
import { BottomNav, MobileHeader, SiteFooter, SiteHeader, Spinner } from "../components/Layout";
import { Ball, Share } from "../components/Icons";
import { QR } from "../components/QR";
import { useToast } from "../components/Toast";
import { dayLabel, isoDay, money, parseDay, PAY_LABEL, relativeDay, STATUS_LABEL } from "../format";
import { useClub, useIsMobile } from "../hooks";

export const useMine = (scope: "upcoming" | "history" | "cancelled" | "all") =>
  useQuery({ queryKey: ["mine", scope], queryFn: () => api<Reservation[]>(`/api/reservations/mine?scope=${scope}`), refetchInterval: 30_000 });

export function inviteText(r: Reservation) {
  const url = `${window.location.origin}/convite/${r.invite_token}`;
  return `Bora jogar padel? ${r.court.name} · ${dayLabel(r.date)} · ${r.start}–${r.end} no Padel Lobby. Entra no jogo: ${url}`;
}

export async function shareReservation(r: Reservation, toast: (m: string) => void) {
  const text = inviteText(r);
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch { /* cancelado → cai no WhatsApp */ }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  toast("Convite aberto no WhatsApp");
}

export function useCancel() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (r: Reservation) => api<{ refund: boolean; free: boolean }>(`/api/reservations/${r.code}/cancel`, { method: "POST", json: {} }),
    onSuccess: (res) => {
      qc.invalidateQueries();
      toast(res.refund ? "Reserva cancelada. O valor será estornado." : "Reserva cancelada.");
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Não foi possível cancelar."),
  });
}

export function confirmCancel(r: Reservation) {
  const msg = r.free_cancel || r.payment_status !== "paid"
    ? `Cancelar a reserva de ${dayLabel(r.date)} às ${r.start}?`
    : `Faltam menos de ${Math.round((new Date(r.starts_at).getTime() - new Date(r.free_cancel_until).getTime()) / 3600000)} h para o jogo: o valor pago NÃO será estornado. Cancelar mesmo assim?`;
  return window.confirm(msg);
}

/** Próxima data com o mesmo dia da semana (para "Repetir"). */
function nextSameWeekday(iso: string, today: string) {
  const d = parseDay(today);
  const target = parseDay(iso).getDay();
  while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  return isoDay(d);
}

export default function Reservations() {
  const mobile = useIsMobile();
  const upcoming = useMine("upcoming");
  const club = useClub().data;
  const next = upcoming.data?.[0];
  const more = upcoming.data?.slice(1) ?? [];

  if (mobile) {
    return (
      <div className="has-bottom-nav">
        <MobileHeader title={<>Minhas <span className="accent">reservas</span></>} />
        {upcoming.isLoading ? <Spinner /> : next ? <NextCardMobile r={next} today={club?.today} /> : <NoUpcoming />}
        {more.length > 0 && (
          <section style={{ margin: "20px 20px 0" }}>
            <h2 className="section-title">Próximas</h2>
            <HistoryList items={more} today={club?.today} />
          </section>
        )}
        <section style={{ margin: "20px 20px 0" }}>
          <h2 className="section-title">Histórico</h2>
          <History mobile today={club?.today} />
        </section>
        <ClubCardMobile />
        <BottomNav />
      </div>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "32px 24px 48px", flex: 1 }}>
        <h1 className="italic-title" style={{ fontSize: 40, lineHeight: 1.05 }}>Minhas <span className="accent">reservas</span></h1>
        <div className="row" style={{ marginTop: 24 }}>
          {upcoming.isLoading ? <div className="grow-2"><Spinner /></div> : next ? <NextCardWeb r={next} today={club?.today} /> : <div className="grow-2"><NoUpcoming /></div>}
          <aside aria-label="O clube" className="card grow-1" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, boxShadow: "none", flexBasis: 300 }}>
            <h2 className="italic-title" style={{ fontSize: 20 }}>Como chegar</h2>
            {club && <iframe className="map" title="Mapa" height={130} style={{ borderRadius: 16 }} loading="lazy"
              src={`https://www.google.com/maps?q=${encodeURIComponent(`${club.address}, Rio Grande, RS`)}&output=embed`} />}
            <div>
              <p style={{ fontSize: 15, fontWeight: 800 }}>{club?.address}</p>
              <p style={{ marginTop: 2, fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>{club?.district}</p>
            </div>
            <a href={club?.maps_url} target="_blank" rel="noreferrer" className="btn btn-soft">Abrir no mapa</a>
          </aside>
        </div>
        {more.length > 0 && (
          <section className="card" style={{ marginTop: 28, padding: 24, boxShadow: "none" }}>
            <h2 className="italic-title" style={{ fontSize: 20 }}>Próximas reservas</h2>
            <HistoryTable items={more} today={club?.today} />
          </section>
        )}
        <section aria-labelledby="hist" className="card" style={{ marginTop: 28, padding: 24, boxShadow: "none" }}>
          <History today={club?.today} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function NoUpcoming() {
  return (
    <section className="hero-m" style={{ margin: "16px 20px 0", padding: 24, flex: "2 1 560px" }}>
      <p className="italic-title" style={{ fontSize: 24 }}>Nenhum jogo marcado</p>
      <p style={{ marginTop: 6, fontSize: 14, fontWeight: 500 }}>Escolha um horário e chame a galera.</p>
      <Link to="/agenda" className="btn btn-white" style={{ marginTop: 16 }}>Reservar quadra</Link>
    </section>
  );
}

function statusText(r: Reservation) {
  if (r.status === "pending") return "AGUARDANDO PIX";
  if (r.status === "checked_in") return "EM QUADRA";
  return `CONFIRMADA · ${PAY_LABEL[r.payment_method]!.toUpperCase()}${r.payment_status === "onsite" ? " (PAGAR NO LOCAL)" : ""}`;
}

function NextCardMobile({ r, today }: { r: Reservation; today?: string }) {
  const toast = useToast();
  const cancel = useCancel();
  const navigate = useNavigate();
  return (
    <section aria-label="Próxima reserva" className="hero-m" style={{ margin: "16px 20px 0", boxShadow: "0 8px 20px rgba(200,16,46,0.25)" }}>
      <div style={{ padding: 18, display: "flex", gap: 14, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="badge badge-ball" style={{ fontSize: 11 }}>{statusText(r)}</span>
          <p className="italic-title" style={{ marginTop: 10, fontSize: 24 }}>{today ? relativeDay(r.date, today) : dayLabel(r.date)} · {r.start}</p>
          <p style={{ marginTop: 4, fontSize: 13, fontWeight: 600 }}>{r.court.name} · {r.duration} min · {r.players.length} jogador{r.players.length > 1 ? "es" : ""}</p>
          <p style={{ marginTop: 6, fontSize: 12, fontWeight: 500 }}>Código <strong style={{ letterSpacing: 1 }}>{r.code}</strong></p>
        </div>
        {r.status === "pending"
          ? <Link to={`/reservas/${r.code}`} className="btn btn-white btn-sm">Pagar Pix</Link>
          : <QR value={r.code} size={72} label={`QR code de check-in da reserva ${r.code}`} />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 18px 18px" }}>
        {r.is_owner ? (
          <button className="btn btn-white" style={{ height: 46, fontSize: 14 }} onClick={() => shareReservation(r, toast)}><Share />Compartilhar</button>
        ) : (
          <button className="btn btn-white" style={{ height: 46, fontSize: 14 }} onClick={() => navigate(`/reservas/${r.code}`)}>Detalhes</button>
        )}
        {r.can_cancel ? (
          <button className="btn btn-ghost-light" style={{ height: 46, fontSize: 14 }} disabled={cancel.isPending}
            onClick={() => confirmCancel(r) && cancel.mutate(r)}>Cancelar</button>
        ) : (
          <Link className="btn btn-ghost-light" style={{ height: 46, fontSize: 14 }} to={`/reservas/${r.code}`}>Detalhes</Link>
        )}
      </div>
    </section>
  );
}

function NextCardWeb({ r, today }: { r: Reservation; today?: string }) {
  const toast = useToast();
  const cancel = useCancel();
  return (
    <section aria-label="Próxima reserva" className="hero grow-2" style={{ padding: 32, boxShadow: "0 12px 30px rgba(200,16,46,0.25)", background: "linear-gradient(160deg, #E8402A 0%, #C8102E 55%, #8E0F1B 100%)" }}>
      <Ball size={200} stroke={1.4} style={{ position: "absolute", right: -50, bottom: -60 }} />
      <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap", position: "relative" }}>
        <div style={{ flex: "1 1 260px" }}>
          <span className="badge badge-ball" style={{ padding: "5px 12px", borderRadius: 12 }}>{statusText(r)}</span>
          <p className="italic-title" style={{ marginTop: 14, fontSize: 44, lineHeight: 1 }}>{today ? relativeDay(r.date, today) : dayLabel(r.date)} · {r.start}</p>
          <p style={{ marginTop: 8, fontSize: 17, fontWeight: 600 }}>{r.court.name} · {r.duration} min · {r.players.length} jogador{r.players.length > 1 ? "es" : ""}</p>
          <p style={{ marginTop: 6, fontSize: 14, fontWeight: 500 }}>Código <strong style={{ letterSpacing: 1 }}>{r.code}</strong></p>
          <div style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {r.status === "pending" && <Link to={`/reservas/${r.code}`} className="btn btn-white">Pagar com Pix</Link>}
            {r.is_owner && r.status !== "pending" && <button className="btn btn-white" onClick={() => shareReservation(r, toast)}>Compartilhar no WhatsApp</button>}
            <a className="btn btn-ghost-light" href={`/api/reservations/${r.code}/calendar.ics`}>Adicionar à agenda</a>
            <Link className="btn btn-ghost-light" to={`/reservas/${r.code}`}>Detalhes</Link>
            {r.can_cancel && <button className="btn btn-link-light" disabled={cancel.isPending} onClick={() => confirmCancel(r) && cancel.mutate(r)}>Cancelar</button>}
          </div>
        </div>
        {r.status !== "pending" && <QR value={r.code} size={130} label={`QR code de check-in da reserva ${r.code}`} />}
      </div>
    </section>
  );
}

function useRepeat(today?: string) {
  const { update } = useBooking();
  const navigate = useNavigate();
  return (r: Reservation) => {
    update({ courtId: r.court.id, start: r.start, duration: r.duration, date: today ? nextSameWeekday(r.date, today) : null, guests: [] });
    navigate("/agenda");
  };
}

function History({ mobile, today }: { mobile?: boolean; today?: string }) {
  const [scope, setScope] = useState<"history" | "cancelled">("history");
  const q = useMine(scope);
  return (
    <>
      {!mobile && (
        <div className="between">
          <h2 id="hist" className="italic-title" style={{ fontSize: 20 }}>Histórico</h2>
          <div role="group" aria-label="Filtro" className="chips">
            <button aria-pressed={scope === "history"} onClick={() => setScope("history")}>Todas</button>
            <button aria-pressed={scope === "cancelled"} onClick={() => setScope("cancelled")}>Canceladas</button>
          </div>
        </div>
      )}
      {q.isLoading ? <Spinner /> : !q.data?.length ? <p className="empty">Nenhuma reserva aqui ainda.</p>
        : mobile ? <HistoryList items={q.data.slice(0, 8)} today={today} /> : <HistoryTable items={q.data} today={today} />}
    </>
  );
}

function HistoryList({ items, today }: { items: Reservation[]; today?: string }) {
  const repeat = useRepeat(today);
  return (
    <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((r) => (
        <li key={r.code} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 16, background: "#fff" }}>
          <Ball size={28} />
          <Link to={`/reservas/${r.code}`} style={{ flex: 1, color: "inherit", textDecoration: "none" }}>
            <p style={{ fontSize: 14, fontWeight: 800 }}>{dayLabel(r.date)} · {r.start}</p>
            <p style={{ marginTop: 2, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>
              {r.court.name} · {r.duration} min{["cancelled", "expired"].includes(r.status) ? ` · ${STATUS_LABEL[r.status]!.text.toLowerCase()}` : ""}
            </p>
          </Link>
          <button className="text-link" onClick={() => repeat(r)}>Repetir</button>
        </li>
      ))}
    </ul>
  );
}

function HistoryTable({ items, today }: { items: Reservation[]; today?: string }) {
  const repeat = useRepeat(today);
  return (
    <div className="table-scroll" style={{ marginTop: 14 }}>
      <table className="table" style={{ minWidth: 620 }}>
        <thead>
          <tr>
            <th scope="col">DATA</th><th scope="col">HORÁRIO</th><th scope="col">QUADRA</th><th scope="col">VALOR</th><th scope="col">SITUAÇÃO</th>
            <th scope="col"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const st = STATUS_LABEL[r.status]!;
            const paidValue = ["cancelled", "expired"].includes(r.status) && r.payment_status !== "paid" ? "—" : money(r.price_cents);
            return (
              <tr key={r.code}>
                <td style={{ fontWeight: 800 }}><Link to={`/reservas/${r.code}`} style={{ color: "inherit", textDecoration: "none" }}>{dayLabel(r.date)}</Link></td>
                <td>{r.start} · {r.duration} min</td>
                <td>{r.court.name}</td>
                <td>{paidValue}{r.payment_status === "refunded" ? " (estornado)" : ""}</td>
                <td><span className={`badge ${st.cls}`}>{st.text}</span></td>
                <td style={{ textAlign: "right" }}><button className="text-link" style={{ fontSize: 15 }} onClick={() => repeat(r)}>Repetir</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClubCardMobile() {
  const club = useClub().data;
  if (!club) return null;
  const wa = club.whatsapp ? `https://wa.me/${club.whatsapp.replace(/\D/g, "")}` : `mailto:${club.email}`;
  return (
    <section aria-label="O clube" className="card" style={{ margin: "16px 20px 0", padding: "14px 16px", borderRadius: 18, boxShadow: "none" }}>
      <p style={{ fontSize: 14, fontWeight: 800 }}>{club.address}</p>
      <p style={{ marginTop: 2, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>{club.district}</p>
      <p style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>{club.amenities.join(" · ")}</p>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <a href={club.maps_url} target="_blank" rel="noreferrer" className="btn btn-soft" style={{ flex: 1, fontSize: 13 }}>Como chegar</a>
        <a href={wa} target="_blank" rel="noreferrer" className="btn btn-gray" style={{ flex: 1 }}>{club.whatsapp ? "WhatsApp" : "E-mail"}</a>
      </div>
    </section>
  );
}
