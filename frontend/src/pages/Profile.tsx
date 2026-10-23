import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Session, type User } from "../api";
import { useAuth } from "../auth";
import { AiVisionCard } from "../components/AiVisionCard";
import { BottomNav, MobileHeader, SiteFooter, SiteHeader, Spinner } from "../components/Layout";
import { Shield } from "../components/Icons";
import { useConfirm } from "../components/Modal";
import { ThemeChooser } from "../components/Theme";
import { useToast } from "../components/Toast";
import { HAND_LABEL, initials, LEVEL_LABEL, money, SIDE_LABEL } from "../format";
import { useClub } from "../hooks";
import { PasswordInput, PlayerFields } from "./Login";
import MyClasses from "./MyClasses";

type Me = User & {
  stats: { played: number; minutes: number; cancelled: number; upcoming: number; spent_cents: number; favorite_court: string | null };
  partners: { name: string; games: number }[];
};

function Section({ id, title, children, highlight }: { id?: string; title: string; children: ReactNode; highlight?: boolean }) {
  return (
    <section id={id} className="card card-pad" style={{ marginTop: 16, boxShadow: "none", outline: highlight ? "3px solid var(--ball)" : undefined }}>
      <h2 className="italic-title" style={{ fontSize: 20, marginBottom: 14 }}>{title}</h2>
      {children}
    </section>
  );
}

const memberSince = (iso?: string) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "";

export default function Profile() {
  const { user, logout, refresh, applySession } = useAuth();
  const club = useClub().data;
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const forced = !!user?.must_change_password || params.get("trocar-senha") === "1";
  const securityRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (forced) securityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [forced]);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me") });
  const err = (e: unknown) => toast(e instanceof ApiError ? e.message : "Não foi possível salvar.");
  const done = (msg: string) => async () => { await refresh(); qc.invalidateQueries({ queryKey: ["me"] }); toast(msg); };

  const [personal, setPersonal] = useState<{ name?: string; phone?: string; marketing_opt_in?: boolean }>({});
  const savePersonal = useMutation({ mutationFn: () => api("/api/me", { method: "PATCH", json: personal }), onSuccess: async () => { await done("Dados atualizados")(); setPersonal({}); }, onError: err });

  const [player, setPlayer] = useState<{ city?: string; level?: string; side?: string; hand?: string }>({});
  const savePlayer = useMutation({
    mutationFn: () => api("/api/me", { method: "PATCH", json: Object.fromEntries(Object.entries(player).map(([k, v]) => [k, v || null])) }),
    onSuccess: async () => { await done("Perfil de jogador salvo")(); setPlayer({}); }, onError: err,
  });

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const changePw = useMutation({
    mutationFn: () => api<Session>("/api/me/password", { method: "POST", json: { current_password: pw.current, new_password: pw.next } }),
    onSuccess: (s) => { applySession(s); setPw({ current: "", next: "", confirm: "" }); toast("Senha alterada. Os outros aparelhos foram desconectados."); if (params.get("trocar-senha")) navigate("/perfil", { replace: true }); },
    onError: err,
  });
  const logoutAll = useMutation({
    mutationFn: () => api<Session>("/api/me/logout-all", { method: "POST" }),
    onSuccess: (s) => { applySession(s); toast("Todos os outros aparelhos foram desconectados."); }, onError: err,
  });

  const [delPw, setDelPw] = useState("");
  const del = useMutation({
    mutationFn: () => api("/api/me", { method: "DELETE", json: { password: delPw } }),
    onSuccess: () => { logout(); navigate("/"); toast("Sua conta foi excluída."); }, onError: err,
  });
  const exportData = async () => {
    try {
      const json = await api<unknown>("/api/me/export");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }));
      a.download = "meus-dados-padel-lobby.json"; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { err(e); }
  };

  if (!user) return null;
  const m = me.data;
  const s = m?.stats;
  const u = m ?? user;

  return (
    <div className="has-bottom-nav">
      <SiteHeader />
      <MobileHeader title={<>Meu <span className="accent">perfil</span></>} />
      <main className="container page" style={{ maxWidth: 820 }}>
        {forced && (
          <p className="alert alert-cream" role="alert" style={{ padding: 14, borderRadius: 14, marginBottom: 16, fontSize: 14, fontWeight: 700 }}>
            Você entrou com uma senha temporária. Escolha uma senha nova para continuar.
          </p>
        )}
        <section className="hero-m" style={{ padding: 22, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span className="avatar" style={{ width: 64, height: 64, borderRadius: 32, background: "#fff", color: "var(--red)", fontSize: 22 }}>{initials(u.name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="italic-title" style={{ fontSize: 24 }}>{u.name}</p>
            <p style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{u.email}</p>
            <p style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {u.level && <span className="badge badge-ball">{LEVEL_LABEL[u.level]}</span>}
              {u.side && <span className="badge" style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}>{SIDE_LABEL[u.side]}</span>}
              {u.hand && <span className="badge" style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}>{HAND_LABEL[u.hand]}</span>}
              {u.member_since && <span className="badge" style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}>Desde {memberSince(u.member_since)}</span>}
            </p>
          </div>
        </section>

        {!s ? <Spinner /> : (
          <div className="kpis" style={{ marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <div className="kpi"><p className="label">JOGOS</p><p className="value">{s.played}</p><p className="sub">{s.cancelled} cancelados</p></div>
            <div className="kpi"><p className="label">HORAS EM QUADRA</p><p className="value">{Math.round(s.minutes / 6) / 10}</p><p className="sub">{s.favorite_court ? `Favorita: ${s.favorite_court}` : "—"}</p></div>
            <div className="kpi"><p className="label">INVESTIDO NO JOGO</p><p className="value">{money(s.spent_cents)}</p></div>
            <Link to="/reservas" className="kpi" style={{ textDecoration: "none", color: "var(--ink)" }}><p className="label">PRÓXIMAS</p><p className="value accent">{s.upcoming}</p><p className="sub">Ver minhas reservas →</p></Link>
          </div>
        )}

        {!!m?.partners.length && (
          <Section title="Com quem você mais joga">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {m.partners.map((p) => (
                <span key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px", borderRadius: 22, background: "var(--bg)", fontSize: 13, fontWeight: 700 }}>
                  <span className="avatar avatar-ball" style={{ width: 32, height: 32, fontSize: 12 }}>{initials(p.name)}</span>{p.name} <span className="muted">· {p.games}</span>
                </span>
              ))}
            </div>
          </Section>
        )}

        {user.is_coach && (
          <Link to="/professor" className="card" style={{ marginTop: 16, padding: 18, display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "var(--ink)", boxShadow: "none" }}>
            <Shield style={{ color: "var(--ball)" }} /><strong style={{ flex: 1 }}>Área do professor · aulas, chamada e alunos</strong><span className="accent">→</span>
          </Link>
        )}

        {user.role === "admin" && (
          <Link to="/admin" className="card" style={{ marginTop: 16, padding: 18, display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "var(--ink)", boxShadow: "none" }}>
            <Shield style={{ color: "var(--red)" }} /><strong style={{ flex: 1 }}>Painel da administração{user.is_master && " · admin master"}</strong><span className="accent">→</span>
          </Link>
        )}

        <Section title="Seus dados">
          <form style={{ display: "flex", flexDirection: "column", gap: 14 }} onSubmit={(e) => { e.preventDefault(); savePersonal.mutate(); }}>
            <label className="field">NOME<input className="input" minLength={2} maxLength={80} required value={personal.name ?? u.name} onChange={(e) => setPersonal({ ...personal, name: e.target.value })} /></label>
            <label className="field">E-MAIL<input className="input" value={u.email} disabled aria-describedby="email-help" /><span id="email-help" style={{ fontWeight: 600 }}>Para trocar o e-mail, fale com a recepção.</span></label>
            <label className="field">WHATSAPP<input className="input" type="tel" maxLength={30} value={personal.phone ?? u.phone ?? ""} onChange={(e) => setPersonal({ ...personal, phone: e.target.value })} /></label>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, fontWeight: 600 }}>
              <input type="checkbox" checked={personal.marketing_opt_in ?? !!u.marketing_opt_in} onChange={(e) => setPersonal({ ...personal, marketing_opt_in: e.target.checked })} style={{ width: 18, height: 18, accentColor: "var(--red)" }} />
              Receber promoções e novidades do clube
            </label>
            <div><button className="btn btn-primary" disabled={savePersonal.isPending || !Object.keys(personal).length}>Salvar dados</button></div>
          </form>
        </Section>

        <Section title="Perfil de jogador">
          <form onSubmit={(e) => { e.preventDefault(); savePlayer.mutate(); }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <PlayerFields value={{ city: player.city ?? u.city, level: player.level ?? u.level, side: player.side ?? u.side, hand: player.hand ?? u.hand }}
                onChange={(k, v) => setPlayer({ ...player, [k]: v })} />
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={savePlayer.isPending || !Object.keys(player).length}>Salvar perfil</button>
          </form>
        </Section>

        <MyClasses />

        <div style={{ marginTop: 16 }}><AiVisionCard compact /></div>

        <div ref={securityRef} style={{ scrollMarginTop: 90 }}>
          <Section id="seguranca" title="Segurança" highlight={forced}>
            <form style={{ display: "flex", flexDirection: "column", gap: 14 }} onSubmit={(e) => {
              e.preventDefault();
              if (pw.next !== pw.confirm) { toast("As senhas novas não conferem."); return; }
              changePw.mutate();
            }}>
              <PasswordInput label={forced ? "SENHA TEMPORÁRIA" : "SENHA ATUAL"} value={pw.current} onChange={(current) => setPw({ ...pw, current })} autoComplete="current-password" minLength={1} />
              <PasswordInput label="NOVA SENHA (MÍNIMO 8)" value={pw.next} onChange={(next) => setPw({ ...pw, next })} autoComplete="new-password" showMeter />
              <label className="field">CONFIRME A NOVA SENHA
                <input className="input" type="password" required autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} aria-invalid={!!pw.confirm && pw.confirm !== pw.next} />
                {!!pw.confirm && pw.confirm !== pw.next && <span className="form-error">As senhas não conferem.</span>}
              </label>
              <div><button className="btn btn-primary" disabled={changePw.isPending}>Trocar senha</button></div>
            </form>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
              <button type="button" className="btn btn-outline" style={{ whiteSpace: "normal", height: "auto", minHeight: 48, textAlign: "center" }} disabled={logoutAll.isPending}
                onClick={async () => { if (await confirm({ title: "Sair de todos os outros aparelhos?", message: "Celulares e computadores onde você entrou vão precisar fazer login de novo. Este aparelho continua conectado.", confirmLabel: "Desconectar" })) logoutAll.mutate(); }}>Sair de todos os outros aparelhos</button>
              <button type="button" className="btn btn-outline" onClick={() => { logout(); navigate("/"); }}>Sair desta conta</button>
            </div>
          </Section>
        </div>

        <Section title="Aparência">
          <ThemeChooser />
          <p className="muted" style={{ fontSize: 13, fontWeight: 500, marginTop: 10 }}>"Automático" segue o tema claro/escuro do seu aparelho.</p>
        </Section>

        <Section title="Privacidade e dados">
          <p className="muted" style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>
            Pela LGPD, você pode baixar uma cópia dos seus dados ou excluir sua conta a qualquer momento. Veja os <Link to="/termos">termos e a política de privacidade</Link>.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button type="button" className="btn btn-outline" onClick={exportData}>Baixar meus dados</button>
          </div>
          {!user.is_master && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 14, fontWeight: 800, color: "var(--red-deep)", cursor: "pointer" }}>Excluir minha conta</summary>
              <form style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}
                onSubmit={async (e) => { e.preventDefault(); if (await confirm({ title: "Excluir sua conta?", message: "Seus dados pessoais serão apagados e você não conseguirá mais entrar. Isso não pode ser desfeito.", confirmLabel: "Excluir conta", cancelLabel: "Manter conta", danger: true })) del.mutate(); }}>
                <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                  Seu nome, e-mail, telefone e perfil serão apagados e você não conseguirá mais entrar. O histórico de reservas e pagamentos
                  fica guardado sem identificação, porque o clube precisa dele na contabilidade. Reservas futuras precisam ser canceladas antes.
                </p>
                <PasswordInput label="CONFIRME COM SUA SENHA" value={delPw} onChange={setDelPw} autoComplete="current-password" minLength={1} />
                <div><button className="btn btn-dark" disabled={del.isPending || !delPw}>Excluir conta definitivamente</button></div>
              </form>
            </details>
          )}
        </Section>

        <Section id="politica" title="Política de reserva">
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 500, color: "var(--muted)", lineHeight: 1.5 }}>
            <li>Cancelamento grátis até <strong>{club?.cancel_free_hours} h</strong> antes do jogo, com estorno integral do valor pago.</li>
            <li>Depois desse prazo a reserva ainda pode ser cancelada para liberar a quadra, mas sem estorno.</li>
            <li>Reservas no Pix ficam seguradas por <strong>{club?.pending_hold_minutes} min</strong> aguardando o pagamento; depois o horário é liberado.</li>
            <li>Até <strong>{club?.max_players}</strong> jogadores por quadra. Reservas abrem com até {club?.booking_horizon_days} dias de antecedência.</li>
            <li>Check-in na recepção a partir de 1 h antes do horário, apresentando o QR code ou o código da reserva.</li>
          </ul>
        </Section>
      </main>
      <SiteFooter />
      <BottomNav />
    </div>
  );
}
