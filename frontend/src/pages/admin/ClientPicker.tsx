import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";

type Client = { id: number; name: string; email: string; phone: string | null; rentals: number };
export type PickedClient = { user_id: number; name: string } | { client: { name: string; phone: string | null; email: string | null } } | null;

const isInternal = (email: string) => email.endsWith("@padellobby.invalid");

/** Busca um cliente/aluno cadastrado ou cadastra um novo (balcão). Devolve o que a API espera: user_id ou client. */
export function ClientPicker({ onChange, label = "ALUNO" }: { onChange: (v: PickedClient) => void; label?: string }) {
  const [mode, setMode] = useState<"search" | "new">("search");
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Client | null>(null);
  const [walk, setWalk] = useState({ name: "", phone: "", email: "" });
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  const search = useQuery({
    queryKey: ["admin", "client-search", q], enabled: mode === "search" && q.length >= 2,
    queryFn: () => api<Client[]>(`/api/admin/users?q=${encodeURIComponent(q)}&limit=8`),
  });
  useEffect(() => {
    if (mode === "search") onChange(picked ? { user_id: picked.id, name: picked.name } : null);
    else onChange(walk.name.trim().length >= 2 ? { client: { name: walk.name.trim(), phone: walk.phone || null, email: walk.email || null } } : null);
  }, [mode, picked, walk]);

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend className="field" style={{ marginBottom: 6 }}>{label}</legend>
      <div className="segmented" role="group" aria-label="Tipo de cadastro">
        <button type="button" aria-pressed={mode === "search"} onClick={() => setMode("search")}>Já cadastrado</button>
        <button type="button" aria-pressed={mode === "new"} onClick={() => { setMode("new"); setPicked(null); }}>Novo</button>
      </div>
      {mode === "search" ? (
        picked ? (
          <div className="between" style={{ padding: "10px 14px", borderRadius: 14, background: "var(--pink)", fontWeight: 700, fontSize: 14 }}>
            <span>{picked.name}<span className="muted" style={{ fontWeight: 600 }}> · {picked.phone || (isInternal(picked.email) ? "balcão" : picked.email)}</span></span>
            <button type="button" className="text-link" onClick={() => setPicked(null)}>Trocar</button>
          </div>
        ) : (
          <>
            <input className="input" placeholder="Buscar por nome, e-mail ou telefone" value={term} onChange={(e) => setTerm(e.target.value)} aria-label={`Buscar ${label.toLowerCase()}`} />
            {q.length >= 2 && (
              <ul className="pick-list">
                {search.isLoading && <li className="muted">Buscando…</li>}
                {search.data?.length === 0 && <li className="muted">Ninguém encontrado. <button type="button" className="text-link" onClick={() => { setMode("new"); setWalk({ ...walk, name: term }); }}>Cadastrar "{term}"</button></li>}
                {search.data?.map((c) => (
                  <li key={c.id}><button type="button" onClick={() => setPicked(c)}>
                    <strong>{c.name}</strong><span className="muted"> · {c.phone || (isInternal(c.email) ? "balcão" : c.email)}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </>
        )
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          <label className="field">NOME<input className="input" required minLength={2} maxLength={80} value={walk.name} onChange={(e) => setWalk({ ...walk, name: e.target.value })} /></label>
          <label className="field">WHATSAPP<input className="input" type="tel" maxLength={30} value={walk.phone} onChange={(e) => setWalk({ ...walk, phone: e.target.value })} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>E-MAIL (OPCIONAL)<input className="input" type="email" maxLength={120} value={walk.email} onChange={(e) => setWalk({ ...walk, email: e.target.value })} /></label>
        </div>
      )}
    </fieldset>
  );
}
