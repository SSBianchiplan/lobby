import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, type User } from "../api";
import { useAuth } from "../auth";
import { BottomNav, MobileHeader, SiteFooter, SiteHeader } from "../components/Layout";
import { Shield } from "../components/Icons";
import { useToast } from "../components/Toast";
import { initials } from "../format";
import { useClub } from "../hooks";

type Me = User & { stats: { played: number; minutes: number; cancelled: number } };

export default function Profile() {
  const { user, logout, refresh } = useAuth();
  const club = useClub().data;
  const toast = useToast();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me") });
  const [form, setForm] = useState<{ name?: string; phone?: string; password?: string }>({});
  const save = useMutation({
    mutationFn: () => api<User>("/api/me", { method: "PATCH", json: { ...form, password: form.password || undefined } }),
    onSuccess: async () => { await refresh(); setForm({}); toast("Perfil atualizado"); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Não foi possível salvar."),
  });
  if (!user) return null;
  const s = me.data?.stats;

  return (
    <div className="has-bottom-nav">
      <SiteHeader />
      <MobileHeader title={<>Meu <span className="accent">perfil</span></>} />
      <main className="container page" style={{ maxWidth: 760 }}>
        <section className="hero-m" style={{ padding: 22, display: "flex", alignItems: "center", gap: 16 }}>
          <span className="avatar" style={{ width: 64, height: 64, borderRadius: 32, background: "#fff", color: "var(--red)", fontSize: 22 }}>{initials(user.name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="italic-title" style={{ fontSize: 24 }}>{user.name}</p>
            <p style={{ fontSize: 13, fontWeight: 600 }}>{user.email}</p>
          </div>
        </section>

        {s && (
          <div className="kpis" style={{ marginTop: 16, gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="kpi"><p className="label">JOGOS</p><p className="value">{s.played}</p></div>
            <div className="kpi"><p className="label">HORAS EM QUADRA</p><p className="value">{Math.round(s.minutes / 6) / 10}</p></div>
            <div className="kpi"><p className="label">CANCELADAS</p><p className="value">{s.cancelled}</p></div>
          </div>
        )}

        {user.role === "admin" && (
          <Link to="/admin" className="card" style={{ marginTop: 16, padding: 18, display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "var(--ink)", boxShadow: "none" }}>
            <Shield style={{ color: "var(--red)" }} /><strong style={{ flex: 1 }}>Painel da administração</strong><span className="accent">→</span>
          </Link>
        )}

        <form className="card card-pad" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14, boxShadow: "none" }}
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <h2 className="italic-title" style={{ fontSize: 20 }}>Seus dados</h2>
          <label className="field">NOME<input className="input" minLength={2} value={form.name ?? user.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field">WHATSAPP<input className="input" type="tel" value={form.phone ?? user.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="field">NOVA SENHA<input className="input" type="password" minLength={6} autoComplete="new-password" placeholder="Deixe em branco para manter" value={form.password ?? ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={save.isPending || !Object.keys(form).length}>Salvar</button>
            <button type="button" className="btn btn-outline" onClick={() => { logout(); navigate("/"); }}>Sair da conta</button>
          </div>
        </form>

        <section id="politica" className="card card-pad" style={{ marginTop: 16, boxShadow: "none" }}>
          <h2 className="italic-title" style={{ fontSize: 20 }}>Política de reserva</h2>
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 500, color: "var(--muted)", lineHeight: 1.5 }}>
            <li>Cancelamento grátis até <strong>{club?.cancel_free_hours} h</strong> antes do jogo, com estorno integral do valor pago.</li>
            <li>Depois desse prazo a reserva ainda pode ser cancelada para liberar a quadra, mas sem estorno.</li>
            <li>Reservas no Pix ficam seguradas por <strong>{club?.pending_hold_minutes} min</strong> aguardando o pagamento; depois o horário é liberado.</li>
            <li>Até <strong>{club?.max_players}</strong> jogadores por quadra. Reservas abrem com até {club?.booking_horizon_days} dias de antecedência.</li>
            <li>Check-in na recepção a partir de 1 h antes do horário, apresentando o QR code ou o código da reserva.</li>
          </ul>
        </section>
      </main>
      <SiteFooter />
      <BottomNav />
    </div>
  );
}
