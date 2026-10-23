import { useState } from "react";
import { initials, money } from "../format";
import type { Quote } from "../api";
import { Plus } from "./Icons";

export type PlayerItem = { key: string | number; name: string; isYou?: boolean; removable?: boolean };

export function Players({ players, max, onAdd, onRemove, size = 44 }: {
  players: PlayerItem[]; max: number; size?: number;
  onAdd?: (name: string) => void; onRemove?: (key: PlayerItem["key"]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const empty = Math.max(0, max - players.length);
  const submit = () => { if (name.trim() && onAdd) { onAdd(name.trim()); setName(""); setAdding(false); } };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {players.map((p, i) => (
          <div className="player" key={p.key}>
            <span className={`avatar ${p.isYou ? "avatar-red" : "avatar-ball"}`} style={{ width: size, height: size, borderRadius: size / 2 }}>
              {p.isYou ? "VC" : initials(p.name) || `J${i + 1}`}
            </span>
            <small>{p.isYou ? "Você" : p.name.split(" ")[0]}</small>
            {p.removable && onRemove && (
              <button className="remove" aria-label={`Remover ${p.name}`} onClick={() => onRemove(p.key)}>×</button>
            )}
          </div>
        ))}
        {onAdd && Array.from({ length: empty }).map((_, i) => (
          <div className="player" key={`add-${i}`}>
            <button className="avatar avatar-add" style={{ width: size, height: size, borderRadius: size / 2 }}
              aria-label="Convidar jogador" onClick={() => setAdding(true)}><Plus /></button>
          </div>
        ))}
      </div>
      {adding && (
        <form style={{ marginTop: 10, display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="sr-only" htmlFor="guest-name">Nome do jogador</label>
          <input id="guest-name" className="input" style={{ height: 44 }} autoFocus placeholder="Nome do jogador" value={name}
            maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-dark btn-sm" style={{ height: 44 }} type="submit">Adicionar</button>
          <button className="btn btn-outline btn-sm" style={{ height: 44 }} type="button" onClick={() => setAdding(false)}>Fechar</button>
        </form>
      )}
    </div>
  );
}

export type Method = "pix" | "card" | "onsite";

export function PaymentOptions({ value, onChange, name = "pg" }: { value: Method; onChange: (m: Method) => void; name?: string }) {
  const opt = (m: Method, label: string, extra?: React.ReactNode) => (
    <label className="pay-option">
      <input type="radio" name={name} checked={value === m} onChange={() => onChange(m)} />
      <span style={{ flex: 1 }}>{label}</span>
      {extra}
    </label>
  );
  return (
    <fieldset style={{ margin: 0, padding: 0, border: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend className="sr-only">Forma de pagamento</legend>
      {opt("pix", "Pix", <span className="badge badge-cream" style={{ fontSize: 11 }}>confirma na hora</span>)}
      {opt("card", "Cartão de crédito")}
      {opt("onsite", "Pagar no local")}
    </fieldset>
  );
}

export function PriceLines({ quote, duration, players }: { quote?: Quote; duration: number; players: number }) {
  if (!quote) return null;
  const n = Math.max(players, 1);
  return (
    <div className="price-lines">
      {quote.lines.length > 1
        ? quote.lines.map((l) => <div key={l.label}><span>{l.label} · {l.minutes} min</span><span>{money(l.cents)}</span></div>)
        : <div><span>Locação {duration} min{quote.promo ? " · promoção" : ""}</span><span>{money(quote.cents)}</span></div>}
      <div><span>Por jogador (÷{n})</span><span>{money(Math.floor(quote.cents / n))}</span></div>
    </div>
  );
}
