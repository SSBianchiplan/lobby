import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth";
import { Spinner } from "../../components/Layout";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { LEVEL_LABEL, money } from "../../format";
import { Panel } from "./shared";

type Row = {
  id: number; name: string; email: string; phone: string | null; role: "player" | "admin"; created_at: string;
  rentals: number; paid_cents: number; last_rental: string | null; is_master: boolean;
  level: string | null; side: string | null; city: string | null; last_login_at: string | null; must_change_password: boolean;
};

export default function Users() {
  const { user } = useAuth();
  const [term, setTerm] = useState("");
  const [role, setRole] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({
    queryKey: ["admin", "users", term, role], placeholderData: keepPreviousData,
    queryFn: () => api<Row[]>(`/api/admin/users?q=${encodeURIComponent(term)}${role ? `&role=${role}` : ""}`),
  });
  const setRoleM = useMutation({
    mutationFn: (v: { id: number; role: string }) => api(`/api/admin/users/${v.id}/role`, { method: "PUT", json: { role: v.role } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); toast("Papel atualizado"); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Falhou."),
  });
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const reset = useMutation({
    mutationFn: (u: Row) => api<{ temporary_password: string }>(`/api/admin/users/${u.id}/reset-password`, { method: "POST" }).then((r) => ({ name: u.name, password: r.temporary_password })),
    onSuccess: (r) => { setTemp(r); qc.invalidateQueries({ queryKey: ["admin", "users"] }); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Falhou."),
  });
  const master = !!user?.is_master;

  return (
    <Panel title="Usuários">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <label className="field" style={{ flex: "2 1 260px" }}>BUSCAR
          <input className="input" placeholder="Nome, e-mail ou telefone" value={term} onChange={(e) => setTerm(e.target.value)} />
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
          <button className="text-link" onClick={() => setTemp(null)} aria-label="Fechar">✕</button>
        </div>
      )}
      {!master && <p className="muted" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Só o admin master promove ou rebaixa administradores.</p>}
      {!q.data ? <Spinner /> : !q.data.length ? <p className="empty">Ninguém encontrado.</p> : (
        <div className="table-scroll">
          <table className="table rt" style={{ minWidth: 1000 }}>
            <thead><tr><th>NOME</th><th>CONTATO</th><th>CATEGORIA</th><th>PAPEL</th><th>LOCAÇÕES</th><th>PAGO</th><th>ÚLTIMO JOGO</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {q.data.map((u) => (
                <tr key={u.id}>
                  <td className="rt-title" style={{ fontWeight: 800 }}>{u.name}{u.must_change_password && <div className="muted" style={{ fontSize: 11 }}>senha temporária pendente</div>}</td>
                  <td data-label="Contato"><span>{u.email}<div className="muted" style={{ fontSize: 12 }}>{[u.phone, u.city].filter(Boolean).join(" · ")}</div></span></td>
                  <td data-label="Categoria">{u.level ? LEVEL_LABEL[u.level] : "—"}</td>
                  <td data-label="Papel">{u.is_master ? <span className="badge badge-red">Admin master</span> : u.role === "admin" ? <span className="badge badge-ball">Admin</span> : <span className="badge badge-off">Jogador</span>}</td>
                  <td data-label="Locações">{u.rentals}</td>
                  <td data-label="Pago">{money(u.paid_cents)}</td>
                  <td data-label="Último jogo">{u.last_rental ? new Date(u.last_rental).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="rt-actions" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {!u.is_master && (u.role !== "admin" || master) && (
                      <button className="btn btn-soft btn-sm" disabled={reset.isPending}
                        onClick={async () => { if (await confirm({ title: "Redefinir senha?", message: <>Gerar uma senha temporária para <strong>{u.name}</strong>? A senha atual deixa de valer e as sessões abertas são encerradas.</>, confirmLabel: "Gerar senha temporária" })) reset.mutate(u); }}>Redefinir senha</button>
                    )}
                    {master && !u.is_master && (u.role === "admin"
                      ? <button className="btn btn-outline btn-sm" onClick={async () => { if (await confirm({ title: "Rebaixar administrador?", message: <><strong>{u.name}</strong> perde o acesso à administração e volta a ser jogador.</>, confirmLabel: "Rebaixar", danger: true })) setRoleM.mutate({ id: u.id, role: "player" }); }}>Rebaixar</button>
                      : <button className="btn btn-dark btn-sm" onClick={async () => { if (await confirm({ title: "Tornar administrador?", message: <><strong>{u.name}</strong> passa a ver e operar toda a administração: agenda, pagamentos, caixa e relatórios.</>, confirmLabel: "Tornar admin" })) setRoleM.mutate({ id: u.id, role: "admin" }); }}>Tornar admin</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
