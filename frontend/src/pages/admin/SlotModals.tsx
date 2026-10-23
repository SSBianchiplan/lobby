import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Quote, type Reservation } from "../../api";
import { Spinner } from "../../components/Layout";
import { Modal, useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { addMinutes, dayLabel, money, PAY_LABEL, STATUS_LABEL } from "../../format";
import { useClub } from "../../hooks";
import { CHANNEL_LABEL, COUNTER_CHANNELS, PAY_STATUS, ReceiveButton, useAdminActions } from "./shared";

type Client = { id: number; name: string; email: string; phone: string | null; level: string | null; rentals: number };
export type SlotTarget = { courtId: number; courtName: string; date: string; time: string; dayTimes: string[]; freeMinutes: number };

const isInternal = (email: string) => email.endsWith("@padellobby.invalid");

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Horário livre: reservar em nome de um cliente (cadastrado ou de balcão) ou bloquear. */
export function SlotModal({ target, onClose }: { target: SlotTarget | null; onClose: () => void }) {
  const [tab, setTab] = useState<"book" | "block">("book");
  useEffect(() => { if (target) setTab("book"); }, [target]);
  return (
    <Modal open={!!target} onClose={onClose} width={620}
      title={target ? <>{target.courtName} · {dayLabel(target.date)} · {target.time}</> : ""}>
      {target && (
        <>
          <div className="segmented" role="tablist" aria-label="Ação" style={{ marginBottom: 16 }}>
            <button role="tab" aria-selected={tab === "book"} aria-pressed={tab === "book"} onClick={() => setTab("book")}>Reservar</button>
            <button role="tab" aria-selected={tab === "block"} aria-pressed={tab === "block"} onClick={() => setTab("block")}>Bloquear horário</button>
          </div>
          {tab === "book" ? <BookForm target={target} onDone={onClose} /> : <BlockForm target={target} onDone={onClose} />}
        </>
      )}
    </Modal>
  );
}

function BookForm({ target, onDone }: { target: SlotTarget; onDone: () => void }) {
  const club = useClub().data;
  const qc = useQueryClient();
  const toast = useToast();
  const durations = club?.durations ?? [60, 90];
  const fits = durations.filter((d) => d <= target.freeMinutes);
  const [duration, setDuration] = useState(fits[0] ?? durations[0]!);
  const [mode, setMode] = useState<"search" | "new">("search");
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<Client | null>(null);
  const [walk, setWalk] = useState({ name: "", phone: "", email: "" });
  const [players, setPlayers] = useState("");
  const [pay, setPay] = useState<"later" | "now">("later");
  const [channel, setChannel] = useState<string>("dinheiro");
  const [error, setError] = useState<string | null>(null);

  const q = useDebounced(term.trim());
  const search = useQuery({
    queryKey: ["admin", "client-search", q], enabled: mode === "search" && q.length >= 2,
    queryFn: () => api<Client[]>(`/api/admin/users?q=${encodeURIComponent(q)}&limit=8`),
  });
  const quote = useQuery({
    queryKey: ["quote", target.courtId, target.date, target.time, duration],
    queryFn: () => api<Quote>(`/api/quote?court_id=${target.courtId}&date=${target.date}&start=${target.time}&duration=${duration}`),
  });
  const book = useMutation({
    mutationFn: () => api<Reservation & { warning: string | null }>("/api/admin/reservations", {
      method: "POST",
      json: {
        court_id: target.courtId, date: target.date, start: target.time, duration,
        ...(mode === "search" ? { user_id: picked?.id } : { client: { name: walk.name, phone: walk.phone || null, email: walk.email || null } }),
        players: players.split(",").map((p) => p.trim()).filter(Boolean).slice(0, 3),
        receive: pay === "now" ? channel : null,
      },
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["availability"] });
      toast(r.warning ?? `Reserva ${r.code} criada para ${r.owner?.name}${r.payment_status === "paid" ? " · pago" : " · a receber"}.`);
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Não foi possível reservar."),
  });
  const canSubmit = fits.includes(duration) && (mode === "search" ? !!picked : walk.name.trim().length >= 2) && !book.isPending;

  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); if (canSubmit) book.mutate(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field" style={{ marginBottom: 6 }}>DURAÇÃO</legend>
        <div className="chips" role="group">
          {durations.map((d) => (
            <button key={d} type="button" aria-pressed={duration === d} disabled={!fits.includes(d)} onClick={() => setDuration(d)}
              title={fits.includes(d) ? undefined : "Não cabe: o horário seguinte está ocupado ou é intervalo"}>{d} min · até {addMinutes(target.time, d)}</button>
          ))}
        </div>
        {fits.length < durations.length && (
          <p className="muted" style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>
            {fits.length ? `Livre só por ${target.freeMinutes} min a partir das ${target.time}.` : `Só ${target.freeMinutes} min livres a partir das ${target.time} — escolha outro horário ou use "Bloquear".`}
          </p>
        )}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend className="field" style={{ marginBottom: 6 }}>CLIENTE</legend>
        <div className="segmented" role="group" aria-label="Tipo de cliente">
          <button type="button" aria-pressed={mode === "search"} onClick={() => setMode("search")}>Cliente cadastrado</button>
          <button type="button" aria-pressed={mode === "new"} onClick={() => { setMode("new"); setPicked(null); }}>Cliente novo (balcão)</button>
        </div>
        {mode === "search" ? (
          picked ? (
            <div className="between" style={{ padding: "10px 14px", borderRadius: 14, background: "var(--pink)", fontWeight: 700, fontSize: 14 }}>
              <span>{picked.name}<span className="muted" style={{ fontWeight: 600 }}> · {picked.phone || (isInternal(picked.email) ? "balcão" : picked.email)}</span></span>
              <button type="button" className="text-link" onClick={() => setPicked(null)}>Trocar</button>
            </div>
          ) : (
            <>
              <input className="input" placeholder="Buscar por nome, e-mail ou telefone" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar cliente" autoFocus />
              {q.length >= 2 && (
                <ul className="pick-list" aria-label="Clientes encontrados">
                  {search.isLoading && <li className="muted">Buscando…</li>}
                  {search.data?.length === 0 && <li className="muted">Ninguém encontrado. <button type="button" className="text-link" onClick={() => { setMode("new"); setWalk({ ...walk, name: term }); }}>Cadastrar "{term}" como cliente novo</button></li>}
                  {search.data?.map((c) => (
                    <li key={c.id}><button type="button" onClick={() => setPicked(c)}>
                      <strong>{c.name}</strong>
                      <span className="muted"> · {c.phone || (isInternal(c.email) ? "balcão" : c.email)} · {c.rentals} jogos</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </>
          )
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            <label className="field">NOME<input className="input" required minLength={2} maxLength={80} value={walk.name} onChange={(e) => setWalk({ ...walk, name: e.target.value })} autoFocus /></label>
            <label className="field">WHATSAPP<input className="input" type="tel" maxLength={30} value={walk.phone} onChange={(e) => setWalk({ ...walk, phone: e.target.value })} /></label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>E-MAIL (OPCIONAL — PERMITE ENTRAR NO APP DEPOIS)
              <input className="input" type="email" maxLength={120} value={walk.email} onChange={(e) => setWalk({ ...walk, email: e.target.value })} />
            </label>
          </div>
        )}
      </fieldset>

      <label className="field">OUTROS JOGADORES (OPCIONAL, SEPARADOS POR VÍRGULA)
        <input className="input" placeholder="Ex.: Carlos, Bia" value={players} onChange={(e) => setPlayers(e.target.value)} />
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend className="field" style={{ marginBottom: 6 }}>PAGAMENTO · {quote.data ? <strong style={{ color: "var(--ink)" }}>{money(quote.data.cents)}</strong> : "…"}</legend>
        <label className="pay-option"><input type="radio" name="pay" checked={pay === "later"} onChange={() => setPay("later")} />Fica a receber (paga no local)</label>
        <label className="pay-option"><input type="radio" name="pay" checked={pay === "now"} onChange={() => setPay("now")} />Recebido agora no balcão
          {pay === "now" && (
            <select className="select" style={{ marginLeft: "auto", height: 38, width: 150, fontSize: 13 }} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Forma de recebimento">
              {COUNTER_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </select>
          )}
        </label>
      </fieldset>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline" onClick={onDone}>Cancelar</button>
        <button className="btn btn-primary" disabled={!canSubmit}>{book.isPending ? "Reservando…" : `Reservar ${quote.data ? money(quote.data.cents) : ""}`}</button>
      </div>
    </form>
  );
}

function BlockForm({ target, onDone }: { target: SlotTarget; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const ends = target.dayTimes.filter((t) => t > target.time).concat(addMinutes(target.dayTimes[target.dayTimes.length - 1]!, 30)).filter((t, i, a) => a.indexOf(t) === i);
  const [end, setEnd] = useState(ends.find((t) => t >= addMinutes(target.time, 60)) ?? ends[0]!);
  const [all, setAll] = useState(false);
  const [reason, setReason] = useState("Manutenção");
  const [error, setError] = useState<string | null>(null);
  const block = useMutation({
    mutationFn: () => api("/api/admin/blocks", { method: "POST", json: { court_id: all ? null : target.courtId, date: target.date, start: target.time, end, reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); qc.invalidateQueries({ queryKey: ["availability"] }); toast("Horário bloqueado"); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Não foi possível bloquear."),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); block.mutate(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <label className="field">INÍCIO<input className="input" value={target.time} disabled /></label>
        <label className="field">ATÉ
          <select className="select" value={end} onChange={(e) => setEnd(e.target.value)}>{ends.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>MOTIVO<input className="input" required minLength={2} maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, fontWeight: 700 }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--red)" }} />
        Bloquear todas as quadras nesse horário
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline" onClick={onDone}>Cancelar</button>
        <button className="btn btn-dark" disabled={block.isPending}>Bloquear {target.time}–{end}</button>
      </div>
    </form>
  );
}

/** Reserva existente: detalhes e ações da recepção. */
export function ReservationModal({ code, onClose }: { code: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "reservation", code], enabled: !!code, queryFn: () => api<Reservation>(`/api/reservations/${code}`) });
  const actions = useAdminActions(() => { qc.invalidateQueries({ queryKey: ["admin"] }); });
  const r = q.data;
  const receivable = r && ((r.payment_status === "onsite" && ["confirmed", "checked_in", "completed"].includes(r.status)) || r.status === "pending");
  return (
    <Modal open={!!code} onClose={onClose} title={<>Reserva <code>{code}</code></>} width={540}
      footer={r && <>
        {r.status === "confirmed" && <button className="btn btn-dark" disabled={actions.checkin.isPending} onClick={() => actions.checkin.mutate(r.code)}>Fazer check-in</button>}
        {receivable && <ReceiveButton r={r} actions={actions} />}
        {r.can_cancel && <button className="btn btn-outline" onClick={() => actions.askCancel(r, onClose)}>Cancelar reserva</button>}
      </>}>
      {!r ? <Spinner /> : (
        <dl className="detail-list">
          <div><dt>Quando</dt><dd>{r.court.name} · {dayLabel(r.date)} · {r.start}–{r.end} ({r.duration} min)</dd></div>
          <div><dt>Cliente</dt><dd>{r.owner?.name}<span className="muted"> · {r.owner?.phone || (r.owner && !isInternal(r.owner.email) ? r.owner.email : "cliente de balcão")}</span></dd></div>
          <div><dt>Jogadores</dt><dd>{r.players.map((p) => p.name).join(", ")} <span className="muted">({r.players.length}/{r.max_players})</span></dd></div>
          <div><dt>Situação</dt><dd><span className={`badge ${STATUS_LABEL[r.status]!.cls}`}>{STATUS_LABEL[r.status]!.text}</span>{r.checked_in_at && <span className="muted"> · check-in {new Date(r.checked_in_at).toLocaleTimeString("pt-BR", { timeStyle: "short" })}</span>}</dd></div>
          <div><dt>Pagamento</dt><dd>{money(r.price_cents)} · {PAY_LABEL[r.payment_method]} · <span className={`badge ${PAY_STATUS[r.payment_status]!.cls}`}>{PAY_STATUS[r.payment_status]!.text}</span></dd></div>
        </dl>
      )}
    </Modal>
  );
}

/** Bloqueio existente: remover. */
export function BlockModal({ block, onClose }: { block: { id: number; reason: string; label: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/admin/blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); qc.invalidateQueries({ queryKey: ["availability"] }); toast("Bloqueio removido"); onClose(); },
  });
  return (
    <Modal open={!!block} onClose={onClose} title="Horário bloqueado" width={440}
      footer={block && <button className="btn btn-dark" disabled={del.isPending}
        onClick={async () => { if (await confirm({ title: "Remover bloqueio?", message: "O horário volta a ficar livre para reservas.", confirmLabel: "Remover" })) del.mutate(block.id); }}>Remover bloqueio</button>}>
      {block && <p style={{ fontSize: 15, fontWeight: 600 }}>{block.label}<br /><span className="muted">Motivo: {block.reason}</span></p>}
    </Modal>
  );
}
