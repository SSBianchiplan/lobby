import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Logo } from "../components/Layout";
import { Ball } from "../components/Icons";

export default function Login({ register = false }: { register?: boolean }) {
  const { login, register: signup } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const u = register
        ? await signup({ name: form.name, email: form.email, phone: form.phone || undefined, password: form.password })
        : await login(form.email, form.password);
      navigate(next === "/" && u.role === "admin" ? "/admin" : next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao conectar.");
    } finally { setBusy(false); }
  };

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={submit} className="card" style={{ width: "100%", maxWidth: 420, overflow: "hidden", boxShadow: "var(--shadow-float)" }}>
        <div className="hero-m" style={{ borderRadius: 0, padding: "22px 22px 26px" }}>
          <Ball size={120} stroke={1.6} style={{ position: "absolute", right: -26, top: -22 }} />
          <div style={{ background: "#fff", borderRadius: 14, padding: "8px 12px", display: "inline-block", position: "relative" }}><Logo height={40} /></div>
          <h1 className="italic-title" style={{ marginTop: 16, fontSize: 28, position: "relative" }}>{register ? "Crie sua conta" : "Entre para reservar"}</h1>
          <p style={{ marginTop: 6, fontSize: 13, fontWeight: 500, position: "relative" }}>{register ? "Leva 30 segundos." : "Use o e-mail da sua conta Padel Lobby."}</p>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {register && <label className="field">NOME<input className="input" required minLength={2} autoComplete="name" value={form.name} onChange={set("name")} /></label>}
          <label className="field">E-MAIL<input className="input" type="email" required autoComplete="email" value={form.email} onChange={set("email")} /></label>
          {register && <label className="field">WHATSAPP (OPCIONAL)<input className="input" type="tel" autoComplete="tel" placeholder="(53) 9xxxx-xxxx" value={form.phone} onChange={set("phone")} /></label>}
          <label className="field">SENHA<input className="input" type="password" required minLength={register ? 6 : 1} autoComplete={register ? "new-password" : "current-password"} value={form.password} onChange={set("password")} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Aguarde…" : register ? "Criar conta" : "Entrar"}</button>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>
            {register ? <>Já tem conta? <Link to={`/entrar?next=${encodeURIComponent(next)}`}>Entrar</Link></>
              : <>Primeira vez? <Link to={`/cadastro?next=${encodeURIComponent(next)}`}>Criar conta</Link></>}
          </p>
          <Link to="/" style={{ fontSize: 13, fontWeight: 700, textAlign: "center", textDecoration: "none" }}>Voltar ao início</Link>
        </div>
      </form>
    </main>
  );
}
