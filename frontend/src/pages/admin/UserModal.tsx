import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth";
import { Spinner } from "../../components/Layout";
import { Modal, useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { dayLabel, HAND_LABEL, initials, isoDay, LEVEL_LABEL, money, SIDE_LABEL, STATUS_LABEL } from "../../format";
import { PAY_STATUS } from "./shared";

type Detail = {
  id: number; name: string; email: string; phone: string | null; role: "player" | "admin"; city: string | null;
  level: string | null; side: string | null; hand: string | null; must_change_password: boolean;
  created_at: string; last_login_at: string | null; disabled_at: string | null; is_master: boolean; is_walk_in: boolean; coach_name: string | null;
  stats: { rentals: number; minutes: number; paid_cents: number; open_cents: number; cancelled: number; future: number };
  reservations: { code: string; court: string; starts_at: string; ends_at: string; status: string; payment_status: string; price_cents: number }[];
  groups: { enrollment_id: number; status: string; name: string; coach: string }[];
  attendance: { present: number; missed: number };
  open_charges: { id: number; description: string; amount_cents: number }[];
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const err = (e: unknown) => (e instanceof ApiError ? e.message : "Falhou.");
const wa = (phone: string) => `https://wa.me/55${phone.replace(/\D/g, "").replace(/^55/, "")}`;

/** Ficha do usuário (Usuários e Alunos): dados, números, reservas, aulas, cobranças e todas as ações. */
export function UserModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: "", email: "", phone: "", city: "", level: "", side: "", hand: "" });
  const [temp, setTemp] = useState<string | null>(null);
  const [lastId, setLastId] = useState<number | null>(null);
  if (id !== lastId) { setLastId(id); setEditing(false); setTemp(null); }
  const q = useQuery({ queryKey: ["admin", "user", id], enabled: id !== null, queryFn: () => api<Detail>(`/api/admin/users/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin"] }); };
  const save = useMutation({
    mutationFn: () => api<Detail>(`/api/admin/users/${id}`, { method: "PUT", json: {
      name: f.name, email: f.email || null, phone: f.phone || null, city: f.city || null, level: f.level || null, side: f.side || null, hand: f.hand || null } }),
    onSuccess: () => { refresh(); setEditing(false); toast("Dados atualizados"); }, onError: (e) => toast(err(e)),
  });
  const reset = useMutation({
    mutationFn: () => api<{ temporary_password: string }>(`/api/admin/users/${id}/reset-password`, { method: "POST" }),
    onSuccess: (r) => { refresh(); setTemp(r.temporary_password); }, onError: (e) => toast(err(e)),
  });
  const active = useMutation({
    mutationFn: (on: boolean) => api(`/api/admin/users/${id}/active`, { method: "PUT", json: { active: on } }),
    onSuccess: (_, on) => { refresh(); toast(on ? "Usuário reativado" : "Usuário inativado"); }, onError: (e) => toast(err(e)),
  });
  const del = useMutation({
    mutationFn: () => api<{ mode: "deleted" | "anonymized" }>(`/api/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: (r) => {
      // a ficha não existe mais: descarta em vez de recarregar (evita um 404)
      onClose(); qc.removeQueries({ queryKey: ["admin", "user", id] });
      qc.invalidateQueries({ predicate: (x) => x.queryKey[0] === "admin" && x.queryKey[1] !== "user" });
      toast(r.mode === "deleted" ? "Conta excluída" : "Conta excluída — histórico mantido sem identificação");
    },
    onError: (e) => toast(err(e)),
  });
  const role = useMutation({
    mutationFn: (r: "player" | "admin") => api(`/api/admin/users/${id}/role`, { method: "PUT", json: { role: r } }),
    onSuccess: () => { refresh(); toast("Papel atualizado"); }, onError: (e) => toast(err(e)),
  });

  const d = q.data;
  const master = !!user?.is_master;
  const self = d?.id === user?.id;
  const canManage = !!d && !d.is_master && !self && (d.role !== "admin" || master);
  const startEdit = () => { if (!d) return; setF({ name: d.name, email: d.is_walk_in ? "" : d.email, phone: d.phone ?? "", city: d.city ?? "", level: d.level ?? "", side: d.side ?? "", hand: d.hand ?? "" }); setEditing(true); };

  return (
    <Modal open={id !== null} onClose={onClose} width={720} title={d ? d.name : "Usuário"}>
      {!d ? <Spinner /> : editing ? (
        <form className="stack gap-14" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <label className="field" style={{ gridColumn: "1 / -1" }}>NOME<input className="input" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">E-MAIL (LOGIN){d.is_walk_in && " — OPCIONAL"}<input className="input" type="email" required={!d.is_walk_in} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label className="field">WHATSAPP<input className="input" type="tel" maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="field">CIDADE<input className="input" maxLength={60} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
            <label className="field">CATEGORIA<select className="select" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="">—</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">LADO<select className="select" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}><option value="">—</option>{Object.entries(SIDE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">MÃO<select className="select" value={f.hand} onChange={(e) => setF({ ...f, hand: e.target.value })}><option value="">—</option>{Object.entries(HAND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <p className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Trocar o e-mail muda o login da pessoa e encerra as sessões abertas.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={save.isPending}>Salvar</button>
          </div>
        </form>
      ) : (
        <div className="stack gap-14">
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span className="avatar avatar-red" style={{ width: 56, height: 56, borderRadius: 28, fontSize: 18 }}>{initials(d.name)}</span>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <p style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{d.is_walk_in ? <span className="muted">cliente de balcão (sem e-mail)</span> : d.email}{d.phone && ` · ${d.phone}`}</p>
              <p style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {d.is_master ? <span className="badge badge-red">Admin master</span> : d.role === "admin" ? <span className="badge badge-ball">Admin</span> : <span className="badge badge-off">Jogador</span>}
                {d.coach_name && <span className="badge badge-cream">Professor</span>}
                {d.disabled_at ? <span className="badge badge-red">Inativo desde {fmtDate(d.disabled_at)}</span> : <span className="badge badge-ok">Ativo</span>}
                {d.must_change_password && <span className="badge badge-cream">Senha temporária pendente</span>}
                {d.level && <span className="badge badge-off">{LEVEL_LABEL[d.level]}</span>}
              </p>
              <p className="muted" style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>Cliente desde {fmtDate(d.created_at)} · último acesso {fmtDate(d.last_login_at)}{d.city ? ` · ${d.city}` : ""}{d.side ? ` · ${SIDE_LABEL[d.side]}` : ""}{d.hand ? ` · ${HAND_LABEL[d.hand]}` : ""}</p>
            </div>
          </div>

          {temp && (
            <p className="alert alert-cream" style={{ padding: 12, borderRadius: 12, fontWeight: 600 }}>
              Senha temporária: <code style={{ fontSize: 17, fontWeight: 900, userSelect: "all" }}>{temp}</code> — passe agora, não aparece de novo.
              {d.phone && <> <a href={`${wa(d.phone)}?text=${encodeURIComponent(`🎾 *Padel Lobby*\n\nSua senha temporária: ${temp}\nEntre em ${location.origin}/entrar e crie a sua senha.`)}`} target="_blank" rel="noopener">Enviar pelo WhatsApp</a></>}
            </p>
          )}

          <div className="kpis user-kpis">
            <div className="kpi"><p className="label">LOCAÇÕES</p><p className="value">{d.stats.rentals}</p><p className="sub">{Math.round(d.stats.minutes / 60)} h · {d.stats.cancelled} canceladas</p></div>
            <div className="kpi"><p className="label">PAGO</p><p className="value">{money(d.stats.paid_cents)}</p><p className="sub">{money(d.stats.open_cents)} a receber</p></div>
            <div className="kpi"><p className="label">RESERVAS FUTURAS</p><p className="value">{d.stats.future}</p></div>
            <div className="kpi"><p className="label">AULAS</p><p className="value">{d.attendance.present}</p><p className="sub">{d.attendance.missed} faltas</p></div>
          </div>

          {!!d.groups.length && <p style={{ fontSize: 14, fontWeight: 600 }}><b>Turmas:</b> {d.groups.map((g) => `${g.name} (prof. ${g.coach}${g.status === "paused" ? ", pausada" : ""})`).join(" · ")}</p>}
          {!!d.open_charges.length && <p className="alert alert-red" style={{ padding: 10, borderRadius: 12, fontSize: 14, fontWeight: 700 }}>Em aberto: {d.open_charges.map((c) => `${c.description} (${money(c.amount_cents)})`).join(" · ")}</p>}

          {!!d.reservations.length && (
            <div>
              <p className="field" style={{ marginBottom: 6 }}>ÚLTIMAS RESERVAS</p>
              <ul className="roster">
                {d.reservations.map((r) => (
                  <li key={r.code}>
                    <span style={{ flex: "1 1 180px", minWidth: 0 }}><strong>{dayLabel(isoDay(new Date(r.starts_at)))} {hhmm(r.starts_at)}</strong> · {r.court}<br /><small className="muted">{r.code} · {money(r.price_cents)}</small></span>
                    <span className={`badge ${STATUS_LABEL[r.status]?.cls}`}>{STATUS_LABEL[r.status]?.text}</span>
                    <span className={`badge ${PAY_STATUS[r.payment_status]?.cls}`}>{PAY_STATUS[r.payment_status]?.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="user-actions">
            {d.phone && <a className="btn btn-outline btn-sm" href={wa(d.phone)} target="_blank" rel="noopener">WhatsApp</a>}
            {(canManage || self) && <button className="btn btn-outline btn-sm" onClick={startEdit}>Editar dados</button>}
            {canManage && <button className="btn btn-soft btn-sm" disabled={reset.isPending}
              onClick={async () => { if (await confirm({ title: "Redefinir senha?", message: <>Gera uma senha temporária para <b>{d.name}</b>; a atual deixa de valer e as sessões abertas caem.</>, confirmLabel: "Gerar senha" })) reset.mutate(); }}>Redefinir senha</button>}
            {master && canManage && (d.role === "admin"
              ? <button className="btn btn-outline btn-sm" onClick={async () => { if (await confirm({ title: "Rebaixar administrador?", message: <><b>{d.name}</b> perde o acesso à administração.</>, confirmLabel: "Rebaixar", danger: true })) role.mutate("player"); }}>Rebaixar</button>
              : <button className="btn btn-outline btn-sm" onClick={async () => { if (await confirm({ title: "Tornar administrador?", message: <><b>{d.name}</b> passa a operar toda a administração.</>, confirmLabel: "Tornar admin" })) role.mutate("admin"); }}>Tornar admin</button>)}
            {canManage && (d.disabled_at
              ? <button className="btn btn-dark btn-sm" disabled={active.isPending} onClick={() => active.mutate(true)}>Reativar</button>
              : <button className="btn btn-outline btn-sm" disabled={active.isPending} onClick={async () => {
                  if (await confirm({ title: "Inativar usuário?", danger: true, confirmLabel: "Inativar",
                    message: <><b>{d.name}</b> não consegue mais entrar e as sessões abertas caem. O histórico fica e dá para reativar depois.{d.stats.future > 0 && <><br /><br />⚠️ Tem <b>{d.stats.future} reserva(s) futura(s)</b>, que continuam valendo — cancele se for o caso.</>}</> })) active.mutate(false);
                }}>Inativar</button>)}
            {canManage && <button className="btn btn-outline btn-sm" style={{ color: "var(--red-deep)" }} disabled={del.isPending} onClick={async () => {
              if (await confirm({ title: "Excluir usuário?", danger: true, confirmLabel: "Excluir definitivamente",
                message: <>Se <b>{d.name}</b> nunca usou o sistema, a conta é apagada. Se tem histórico, os dados pessoais são apagados e reservas e pagamentos ficam sem identificação. Matrículas e cobranças em aberto são encerradas. Não dá para desfazer.</> })) del.mutate();
            }}>Excluir</button>}
          </div>
          {!canManage && !self && <p className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{d.is_master ? "O admin master não pode ser alterado por aqui." : "Só o admin master altera outros administradores."}</p>}
        </div>
      )}
    </Modal>
  );
}
