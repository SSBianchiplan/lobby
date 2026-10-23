import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, type Court } from "../api";
import { useAuth } from "../auth";
import { Logo, Spinner } from "../components/Layout";
import { Ball } from "../components/Icons";
import { useToast } from "../components/Toast";
import { dayLabel, money } from "../format";

type InviteInfo = {
  court: Court; date: string; weekday: string; start: string; end: string; duration: number; status: string;
  owner_name: string; players: string[]; max_players: number; per_player_cents: number; joined: boolean; code: string | null;
};

export default function Invite() {
  const { token = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ["invite", token, user?.id], queryFn: () => api<InviteInfo>(`/api/invites/${token}`) });
  const join = useMutation({
    mutationFn: () => api<{ code: string }>(`/api/invites/${token}/join`, { method: "POST" }),
    onSuccess: (r) => { toast("Você está no jogo!"); navigate(`/reservas/${r.code}`); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Não foi possível entrar."),
  });
  const i = q.data;
  const open = i && ["pending", "confirmed"].includes(i.status);
  const full = i && i.players.length >= i.max_players;

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 420, overflow: "hidden", boxShadow: "var(--shadow-float)" }}>
        <div style={{ padding: "18px 20px", display: "flex", justifyContent: "center" }}><Link to="/"><Logo height={48} /></Link></div>
        {!i ? (q.isError ? <p className="empty">Convite inválido ou expirado.</p> : <Spinner />) : (
          <>
            <div className="hero-m" style={{ borderRadius: 0, padding: 22 }}>
              <Ball size={110} stroke={1.6} style={{ position: "absolute", right: -26, top: -22 }} />
              <p style={{ fontSize: 13, fontWeight: 700, position: "relative" }}>{i.owner_name} te chamou para jogar</p>
              <p className="italic-title" style={{ marginTop: 6, fontSize: 28, position: "relative" }}>{dayLabel(i.date)} · {i.start}</p>
              <p style={{ marginTop: 4, fontSize: 14, fontWeight: 600, position: "relative" }}>{i.court.name} · {i.duration} min</p>
            </div>
            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
              <p className="section-title">Jogadores · {i.players.length} de {i.max_players}</p>
              <p style={{ fontSize: 15, fontWeight: 700 }}>{i.players.join(", ")}</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>Cada um paga cerca de <strong style={{ color: "var(--red)" }}>{money(i.per_player_cents)}</strong></p>
              {i.joined ? (
                <Link to={`/reservas/${i.code}`} className="btn btn-primary btn-lg">Você já está no jogo · ver reserva</Link>
              ) : !open ? (
                <p className="alert alert-cream">Essa reserva não está mais ativa.</p>
              ) : full ? (
                <p className="alert alert-cream">A quadra já está completa.</p>
              ) : user ? (
                <button className="btn btn-primary btn-lg" disabled={join.isPending} onClick={() => join.mutate()}>Entrar no jogo</button>
              ) : (
                <Link to={`/entrar?next=/convite/${token}`} className="btn btn-primary btn-lg">Entrar para confirmar presença</Link>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
