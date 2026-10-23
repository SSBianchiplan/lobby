import { useId, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, type User } from "../api";
import { useAuth } from "../auth";
import { Logo } from "../components/Layout";
import { Ball } from "../components/Icons";
import { HAND_LABEL, LEVEL_LABEL, SIDE_LABEL } from "../format";
import { useClub } from "../hooks";

/** 0–4: comprimento, maiúsculas/minúsculas, números, símbolos. */
export function passwordScore(p: string) {
  if (p.length < 8) return 0;
  return 1 + Number(/[a-z]/.test(p) && /[A-Z]/.test(p)) + Number(/\d/.test(p)) + Number(/[^A-Za-z0-9]/.test(p) || p.length >= 14);
}
const SCORE = ["Muito curta", "Fraca", "Razoável", "Boa", "Forte"];

export function PasswordInput({ label, value, onChange, autoComplete, minLength = 8, showMeter = false }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string; minLength?: number; showMeter?: boolean;
}) {
  const [show, setShow] = useState(false);
  const id = useId();
  const score = passwordScore(value);
  // botão e medidor ficam fora do <label>: senão entram no nome acessível do campo ("SENHA Mostrar Forte")
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span style={{ position: "relative", display: "block" }}>
        <input id={id} className="input" type={show ? "text" : "password"} required minLength={minLength} autoComplete={autoComplete}
          value={value} onChange={(e) => onChange(e.target.value)} style={{ paddingRight: 80 }} aria-describedby={showMeter ? `${id}-forca` : undefined} />
        <button type="button" className="text-link" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          style={{ position: "absolute", right: 12, top: 0, height: 50, padding: 0 }}>{show ? "Ocultar" : "Mostrar"}</button>
      </span>
      {showMeter && value && (
        <span id={`${id}-forca`} style={{ display: "flex", alignItems: "center", gap: 8 }} aria-live="polite">
          <span className="bar" style={{ flex: 1, height: 6 }} aria-hidden="true"><i style={{ width: `${(score / 4) * 100}%`, background: score < 2 ? "var(--red)" : score < 3 ? "var(--ball)" : "var(--ok-ink)" }} /></span>
          <span style={{ fontWeight: 700 }}>Força da senha: {SCORE[score]}</span>
        </span>
      )}
    </div>
  );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 460, overflow: "hidden", boxShadow: "var(--shadow-float)" }}>
        <div className="hero-m" style={{ borderRadius: 0, padding: "22px 22px 26px" }}>
          <Ball size={120} stroke={1.6} style={{ position: "absolute", right: -26, top: -22 }} />
          <div style={{ background: "#fff", borderRadius: 14, padding: "8px 12px", display: "inline-block", position: "relative" }}><Logo height={40} /></div>
          <h1 className="italic-title" style={{ marginTop: 16, fontSize: 28, position: "relative" }}>{title}</h1>
          <p style={{ marginTop: 6, fontSize: 13, fontWeight: 500, position: "relative" }}>{subtitle}</p>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </main>
  );
}

function useAfterAuth() {
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const navigate = useNavigate();
  return {
    next,
    go: (u: User) => navigate(u.must_change_password ? "/perfil?trocar-senha=1" : next === "/" && u.role === "admin" ? "/admin" : next, { replace: true }),
  };
}

export default function Login({ register = false }: { register?: boolean }) {
  return register ? <Register /> : <SignIn />;
}

function SignIn() {
  const { login } = useAuth();
  const club = useClub().data;
  const { next, go } = useAfterAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const wa = club?.whatsapp ? `https://wa.me/${club.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! Esqueci minha senha do Padel Lobby. Meu e-mail é ${form.email || "…"}.`)}` : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { go(await login(form.email, form.password)); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Falha ao conectar."); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Entre para reservar" subtitle="Use o e-mail da sua conta Padel Lobby.">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="field">E-MAIL<input className="input" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <PasswordInput label="SENHA" value={form.password} onChange={(password) => setForm({ ...form, password })} autoComplete="current-password" minLength={1} />
        <button type="button" className="text-link" style={{ alignSelf: "flex-end", padding: 0, marginTop: -6 }} onClick={() => setForgot(!forgot)} aria-expanded={forgot}>Esqueci minha senha</button>
        {forgot && (
          <div className="alert alert-cream" style={{ padding: 14, borderRadius: 14, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
            Fale com a recepção: ela gera uma <strong>senha temporária</strong> para você e, no primeiro acesso, você escolhe uma nova.
            {wa ? <> <a href={wa} target="_blank" rel="noopener">Chamar no WhatsApp</a>.</> : club?.email ? <> Ou escreva para <a href={`mailto:${club.email}`}>{club.email}</a>.</> : null}
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Aguarde…" : "Entrar"}</button>
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>
          Primeira vez? <Link to={`/cadastro?next=${encodeURIComponent(next)}`}>Criar conta</Link>
        </p>
        <Link to="/" style={{ fontSize: 13, fontWeight: 700, textAlign: "center", textDecoration: "none" }}>Voltar ao início</Link>
      </form>
    </AuthShell>
  );
}

function Register() {
  const { register } = useAuth();
  const { next, go } = useAfterAuth();
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "", confirm: "", city: "", level: "", side: "", hand: "", terms: false, marketing: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const mismatch = f.confirm.length > 0 && f.confirm !== f.password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setError("As senhas não conferem."); return; }
    if (!f.terms) { setError("Para criar a conta, aceite os termos de uso e a política de privacidade."); return; }
    setBusy(true); setError(null);
    try {
      go(await register({
        name: f.name, email: f.email, phone: f.phone || undefined, password: f.password, accept_terms: f.terms,
        city: f.city || undefined, level: f.level || undefined, side: f.side || undefined, hand: f.hand || undefined, marketing_opt_in: f.marketing,
      }));
    } catch (err) { setError(err instanceof ApiError ? err.message : "Falha ao conectar."); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Crie sua conta" subtitle="Leva 30 segundos. O perfil de jogador é opcional.">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="field">NOME COMPLETO<input className="input" required minLength={2} maxLength={80} autoComplete="name" value={f.name} onChange={set("name")} /></label>
        <label className="field">E-MAIL<input className="input" type="email" required autoComplete="email" value={f.email} onChange={set("email")} /></label>
        <label className="field">WHATSAPP (OPCIONAL)<input className="input" type="tel" autoComplete="tel" placeholder="(53) 9xxxx-xxxx" maxLength={30} value={f.phone} onChange={set("phone")} /></label>
        <PasswordInput label="SENHA (MÍNIMO 8 CARACTERES)" value={f.password} onChange={(password) => setF({ ...f, password })} autoComplete="new-password" showMeter />
        <label className="field">CONFIRME A SENHA
          <input className="input" type="password" required autoComplete="new-password" value={f.confirm} onChange={set("confirm")} aria-invalid={mismatch} />
          {mismatch && <span className="form-error">As senhas não conferem.</span>}
        </label>

        <details className="card" style={{ boxShadow: "none", border: "1px solid var(--border)", borderRadius: 16, padding: "12px 14px" }}>
          <summary style={{ fontSize: 14, fontWeight: 800, cursor: "pointer" }}>Perfil de jogador <span className="muted" style={{ fontWeight: 600 }}>(opcional)</span></summary>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <PlayerFields value={f} onChange={(k, v) => setF({ ...f, [k]: v })} />
          </div>
        </details>

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, fontWeight: 600, lineHeight: 1.45 }}>
          <input type="checkbox" checked={f.terms} onChange={(e) => setF({ ...f, terms: e.target.checked })} required style={{ width: 18, height: 18, accentColor: "var(--red)", marginTop: 1, flex: "none" }} />
          <span>Li e aceito os <Link to="/termos" target="_blank">termos de uso e a política de privacidade</Link>.</span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, fontWeight: 600, lineHeight: 1.45, color: "var(--muted)" }}>
          <input type="checkbox" checked={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.checked })} style={{ width: 18, height: 18, accentColor: "var(--red)", marginTop: 1, flex: "none" }} />
          <span>Quero receber promoções e novidades do clube.</span>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Aguarde…" : "Criar conta"}</button>
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>
          Já tem conta? <Link to={`/entrar?next=${encodeURIComponent(next)}`}>Entrar</Link>
        </p>
      </form>
    </AuthShell>
  );
}

/** Categoria, lado, mão e cidade — usados no cadastro e no perfil. */
export function PlayerFields({ value, onChange }: {
  value: { city?: string | null; level?: string | null; side?: string | null; hand?: string | null };
  onChange: (k: "city" | "level" | "side" | "hand", v: string) => void;
}) {
  const sel = (k: "level" | "side" | "hand", label: string, opts: Record<string, string>) => (
    <label className="field">{label}
      <select className="select" value={value[k] ?? ""} onChange={(e) => onChange(k, e.target.value)}>
        <option value="">Não informar</option>
        {Object.entries(opts).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <>
      {sel("level", "CATEGORIA", LEVEL_LABEL)}
      {sel("side", "LADO NA QUADRA", SIDE_LABEL)}
      {sel("hand", "MÃO DOMINANTE", HAND_LABEL)}
      <label className="field">CIDADE<input className="input" maxLength={60} autoComplete="address-level2" value={value.city ?? ""} onChange={(e) => onChange("city", e.target.value)} /></label>
    </>
  );
}
