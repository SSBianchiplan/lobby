import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Spinner } from "../../components/Layout";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { money } from "../../format";

type Preview = {
  users: number; reservations: number; payments: number; payments_cents: number; players: number;
  invited_elsewhere: number; notifications: number; closings: number; kept_reservations: number; kept_users: number;
  sample: { name: string; email: string }[];
};

/** Zona de perigo do admin master: apaga os dados de exemplo do seed para a base ir limpa para produção. */
export default function DemoPurge() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const q = useQuery({ queryKey: ["admin", "demo-data"], queryFn: () => api<Preview>("/api/admin/maintenance/demo-data") });
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const purge = useMutation({
    mutationFn: () => api<{ deleted: Record<string, number> }>("/api/admin/maintenance/purge-demo", { method: "POST", json: { confirm, password } }),
    onSuccess: (r) => {
      setConfirm(""); setPassword("");
      qc.invalidateQueries();
      toast(`Base limpa: ${r.deleted.users} contas e ${r.deleted.reservations} reservas de exemplo apagadas.`);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Falhou."),
  });
  const d = q.data;
  const ready = confirm.trim().toUpperCase() === "APAGAR" && password.length > 0;

  return (
    <section className="card card-pad" style={{ boxShadow: "none", border: "2px solid var(--red)" }} aria-labelledby="purge-t">
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: "var(--red-deep)" }}>ZONA DE PERIGO · SÓ ADMIN MASTER</p>
      <h2 id="purge-t" className="italic-title" style={{ fontSize: 22, marginTop: 4 }}>Limpar dados de exemplo</h2>
      <p className="muted" style={{ fontSize: 14, fontWeight: 500, marginTop: 6, lineHeight: 1.5 }}>
        Apaga as contas de demonstração criadas na instalação (<code>jogador@padellobby.com.br</code> e <code>@exemplo.com</code>) e tudo o que é delas,
        para a base começar limpa em produção. <strong>Não toca</strong> em administradores, configurações, preços, feriados, quadras, bloqueios
        nem em contas e reservas reais. Não dá para desfazer.
      </p>

      {!d ? <Spinner /> : d.users === 0 ? (
        <p className="alert alert-cream" style={{ marginTop: 14, padding: 14, borderRadius: 14, fontSize: 14, fontWeight: 700 }}>
          Nenhum dado de exemplo na base. Tudo pronto para produção.
        </p>
      ) : (
        <>
          <div className="kpis" style={{ marginTop: 14 }}>
            <div className="kpi"><p className="label">CONTAS DE EXEMPLO</p><p className="value accent">{d.users}</p><p className="sub">{d.sample.slice(0, 3).map((s) => s.name).join(", ")}{d.users > 3 ? "…" : ""}</p></div>
            <div className="kpi"><p className="label">RESERVAS</p><p className="value">{d.reservations}</p><p className="sub">{d.players} jogadores · {d.notifications} notificações</p></div>
            <div className="kpi"><p className="label">PAGAMENTOS</p><p className="value">{d.payments}</p><p className="sub">{money(d.payments_cents)} fictícios</p></div>
            <div className="kpi"><p className="label">FECHAMENTOS AFETADOS</p><p className="value">{d.closings}</p><p className="sub">dias com dinheiro de exemplo</p></div>
          </div>
          <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>
            Ficam: <strong>{d.kept_users}</strong> contas e <strong>{d.kept_reservations}</strong> reservas que não são de exemplo.
            {d.invited_elsewhere > 0 && <> Em {d.invited_elsewhere} reserva(s) real(is) um jogador de exemplo foi convidado: o nome fica, o vínculo com a conta sai.</>}
          </p>
          <form style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, alignItems: "end" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (ready && await confirmDialog({ title: "Apagar dados de exemplo?", message: <>Serão apagadas definitivamente <strong>{d.users} contas</strong> e <strong>{d.reservations} reservas</strong> de exemplo, com seus pagamentos. Não dá para desfazer.</>, confirmLabel: "Apagar definitivamente", danger: true })) purge.mutate();
            }}>
            <label className="field">DIGITE APAGAR PARA CONFIRMAR
              <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" placeholder="APAGAR" />
            </label>
            <label className="field">SUA SENHA
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <button className="btn btn-dark" style={{ height: 50 }} disabled={!ready || purge.isPending}>{purge.isPending ? "Apagando…" : "Apagar dados de exemplo"}</button>
          </form>
        </>
      )}
    </section>
  );
}
