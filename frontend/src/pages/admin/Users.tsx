import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth";
import { Spinner } from "../../components/Layout";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { LEVEL_LABEL, money } from "../../format";
import { ManualCard } from "./Manual";
import { UserModal } from "./UserModal";
import { Panel } from "./shared";

type Row = {
  id: number; name: string; email: string; phone: string | null; role: "player" | "admin"; created_at: string;
  rentals: number; paid_cents: number; last_rental: string | null; is_master: boolean; disabled_at: string | null; future_reservations: number;
  level: string | null; side: string | null; city: string | null; last_login_at: string | null; must_change_password: boolean;
};

export default function Users() {
  const { user } = useAuth();
  const [term, setTerm] = useState("");
  const [role, setRole] = useState("");
  const [state, setState] = useState("active");
  const [open, setOpen] = useState<number | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["admin", "users", term, role, state], placeholderData: keepPreviousData,
    queryFn: () => api<Row[]>(`/api/admin/users?q=${encodeURIComponent(term)}${role ? `&role=${role}` : ""}&state=${state}`),
  });
  const master = !!user?.is_master;
  const [temp, setTemp] = useState<{ name: string; password: string; email?: string; phone?: string | null } | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack gap-18">
    <ManualCard />
    <Panel title="Usuários" actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Novo usuário</button>}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <label className="field" style={{ flex: "2 1 260px" }}>BUSCAR
          <input className="input" placeholder="Nome, e-mail ou telefone" value={term} onChange={(e) => setTerm(e.target.value)} />
        </label>
        <label className="field" style={{ flex: "1 1 140px" }}>STATUS
          <select className="select" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option>
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 160px" }}>PAPEL
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Todos</option><option value="admin">Administradores</option><option value="player">Jogadores</option>
          </select>
        </label>
      </div>
      {temp && (
        <div className="alert alert-cream" role="status" style={{ padding: 14, borderRadius: 14, marginBottom: 12, fontSize: 14, fontWeight: 600, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>Senha temporária de <strong>{temp.name}</strong>: <code style={{ fontSize: 18, fontWeight: 900, userSelect: "all" }}>{temp.password}</code><br />
            Passe a senha agora — ela não aparece de novo. No próximo acesso, a pessoa escolhe uma senha nova.</span>
          <button className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(temp.password); toast("Copiada"); }}>Copiar</button>
          {temp.phone && <a className="btn btn-primary btn-sm" target="_blank" rel="noopener" href={`https://wa.me/55${temp.phone.replace(/\D/g, "").replace(/^55/, "")}?text=${encodeURIComponent(
            `🎾 *Padel Lobby*\n\nOlá, ${temp.name.split(" ")[0]}! Sua conta está pronta.\n\n👉 Entre em ${location.origin}/entrar\nE-mail: ${temp.email ?? ""}\nSenha temporária: ${temp.password}\n\nNo primeiro acesso você cria sua senha.`)}`}>Enviar pelo WhatsApp</a>}
          <button className="text-link" onClick={() => setTemp(null)} aria-label="Fechar">✕</button>
        </div>
      )}
      {!master && <p className="muted" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Só o admin master promove ou rebaixa administradores.</p>}
      {!q.data ? <Spinner /> : !q.data.length ? <p className="empty">Ninguém encontrado.</p> : (
        <div className="table-scroll">
          <table className="table rt" style={{ minWidth: 700 }}>
            <thead><tr><th>NOME</th><th>CONTATO</th><th className="hide-md">CATEGORIA</th><th>PAPEL</th><th>LOCAÇÕES</th><th>PAGO</th><th className="hide-md">ÚLTIMO JOGO</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {q.data.map((u) => (
                <tr key={u.id} className="row-link" tabIndex={0} onClick={() => setOpen(u.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(u.id); } }}
                  aria-label={`Abrir ficha de ${u.name}`} style={{ opacity: u.disabled_at ? 0.6 : 1 }}>
                  <td className="rt-title" style={{ fontWeight: 800 }}>{u.name}{u.must_change_password && <div className="muted" style={{ fontSize: 11 }}>senha temporária pendente</div>}</td>
                  <td data-label="Contato"><span style={{ overflowWrap: "anywhere" }}>{u.email.endsWith("@padellobby.invalid") ? <span className="muted">cliente de balcão (sem e-mail)</span> : u.email}<div className="muted" style={{ fontSize: 12 }}>{[u.phone, u.city].filter(Boolean).join(" · ")}</div></span></td>
                  <td className="hide-md" data-label="Categoria">{u.level ? LEVEL_LABEL[u.level] : "—"}</td>
                  <td data-label="Papel">{u.is_master ? <span className="badge badge-red">Admin master</span> : u.role === "admin" ? <span className="badge badge-ball">Admin</span> : <span className="badge badge-off">Jogador</span>}</td>
                  <td data-label="Locações">{u.rentals}</td>
                  <td data-label="Pago">{money(u.paid_cents)}</td>
                  <td className="hide-md" data-label="Último jogo">{u.last_rental ? new Date(u.last_rental).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="rt-actions users-actions">
                    {u.disabled_at && <span className="badge badge-red">Inativo</span>}
                    <span className="text-link" aria-hidden="true">Abrir ficha →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <UserModal id={open} onClose={() => setOpen(null)} />
      <NewUserModal open={creating} master={master} onClose={() => setCreating(false)}
        onCreated={(u) => { setCreating(false); setTemp(u); qc.invalidateQueries({ queryKey: ["admin", "users"] }); toast("Usuário criado"); }} />
    </Panel>
    </div>
  );
}

function NewUserModal({ open, master, onClose, onCreated }: {
  open: boolean; master: boolean; onClose: () => void;
  onCreated: (u: { name: string; password: string; email: string; phone: string | null }) => void;
}) {
  const empty = { name: "", email: "", phone: "", role: "player", level: "", city: "" };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ name: string; email: string; temporary_password: string }>("/api/admin/users", {
      method: "POST", json: { name: f.name, email: f.email, phone: f.phone || null, role: f.role, level: f.level || null, city: f.city || null },
    }),
    onSuccess: (r) => { onCreated({ name: r.name, email: r.email, password: r.temporary_password, phone: f.phone || null }); setF(empty); setError(null); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falhou."),
  });
  return (
    <Modal open={open} onClose={onClose} title="Novo usuário" width={560}>
      <form style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label className="field" style={{ gridColumn: "1 / -1" }}>NOME COMPLETO<input className="input" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">E-MAIL<input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field">WHATSAPP<input className="input" type="tel" maxLength={30} placeholder="(53) 9xxxx-xxxx" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className="field">PAPEL
            <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="player">Jogador</option>
              {master && <option value="admin">Administrador</option>}
            </select>
          </label>
          <label className="field">CATEGORIA
            <select className="select" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
              <option value="">Não informar</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>CIDADE<input className="input" maxLength={60} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
        </div>
        <p className="muted" style={{ fontSize: 12, fontWeight: 600 }}>A conta é criada com uma senha temporária, mostrada uma única vez. No primeiro acesso a pessoa cria a própria senha e aceita os termos.{!master && " Administradores só podem ser criados pelo admin master."}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={save.isPending}>Criar usuário</button>
        </div>
      </form>
    </Modal>
  );
}
