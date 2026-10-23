import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Spinner } from "../../components/Layout";
import { addMinutes, dayLabel, isoDay, STATUS_LABEL } from "../../format";
import { hours, Panel, PAY_STATUS } from "./shared";

type Cell =
  | { s: "free" } | { s: "past" }
  | { s: "block"; reason: string; id: number }
  | { s: "res"; code: string; status: string; pay: string; who: string; first: boolean };
type Day = {
  date: string; weekday: string; holiday: string | null; open: boolean; times: string[];
  cells: Record<string, Cell[]>; free_minutes: Record<string, number>; booked_minutes: Record<string, number>;
};
type Occ = { courts: { id: number; number: number; name: string }[]; days: Day[] };

const LEGEND: [string, string][] = [
  ["occ-free", "Livre"], ["occ-res", "Reservado e pago"], ["occ-open", "Reservado · a receber"],
  ["occ-pending", "Aguardando Pix"], ["occ-block", "Bloqueado"], ["occ-past", "Já passou"],
];

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };

function cellClass(c: Cell) {
  if (c.s === "free") return "occ-free";
  if (c.s === "past") return "occ-past";
  if (c.s === "block") return "occ-block";
  if (c.status === "pending") return "occ-pending";
  return c.pay === "onsite" ? "occ-open" : "occ-res";
}

function cellTitle(c: Cell, court: string, t: string) {
  if (c.s === "res") return `${court} ${t} · ${c.code} · ${c.who} · ${STATUS_LABEL[c.status]?.text} · ${PAY_STATUS[c.pay]?.text}`;
  if (c.s === "block") return `${court} ${t} · bloqueado: ${c.reason}`;
  return `${court} ${t} · ${c.s === "free" ? "livre" : "passado"}`;
}

export default function Occupancy() {
  const [start, setStart] = useState(() => isoDay(new Date()));
  const [days, setDays] = useState(1);
  const q = useQuery({ queryKey: ["admin", "occupancy", start, days], queryFn: () => api<Occ>(`/api/admin/occupancy?start=${start}&days=${days}`), refetchInterval: 30_000 });
  const d = q.data;

  return (
    <div className="stack gap-18">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="field" style={{ width: 180 }}>A PARTIR DE
          <input className="input" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </label>
        <div className="chips" role="group" aria-label="Quantos dias">
          {[1, 3, 7].map((n) => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n === 1 ? "1 dia" : `${n} dias`}</button>)}
        </div>
        <ul className="occ-legend" aria-label="Legenda">
          {LEGEND.map(([cls, label]) => <li key={cls}><i className={cls} />{label}</li>)}
        </ul>
      </div>

      {!d ? <Spinner /> : d.days.map((day) => {
        const free = d.courts.reduce((s, c) => s + (day.free_minutes[c.id] ?? 0), 0);
        const booked = d.courts.reduce((s, c) => s + (day.booked_minutes[c.id] ?? 0), 0);
        return (
          <Panel key={day.date} title={<>{dayLabel(day.date)}{day.holiday && <span className="badge badge-cream" style={{ marginLeft: 10, fontStyle: "normal" }}>{day.holiday}</span>}</>}
            actions={day.open ? <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>{hours(booked)} reservadas · {hours(free)} livres</span> : undefined}>
            {!day.open ? <p className="empty">Fechado.</p> : (
              <div className="table-scroll">
                <div className="occ-grid" style={{ gridTemplateColumns: `56px repeat(${d.courts.length}, minmax(150px, 1fr))` }}>
                  <span />
                  {d.courts.map((c) => (
                    <div key={c.id} className="occ-head">{c.name}<small>{hours(day.free_minutes[c.id] ?? 0)} livres</small></div>
                  ))}
                  {day.times.map((t, i) => (
                    <div key={t} style={{ display: "contents" }}>
                      {i > 0 && toMin(t) - toMin(day.times[i - 1]!) > 30 && (
                        <div className="occ-break">Intervalo · {addMinutes(day.times[i - 1]!, 30)}–{t}</div>
                      )}
                      <span className="occ-time">{t.endsWith(":00") ? t : ""}</span>
                      {d.courts.map((c) => {
                        const cell = day.cells[c.id]![i]!;
                        return (
                          <div key={c.id} className={`occ-cell ${cellClass(cell)}${cell.s === "res" && !cell.first ? " cont" : ""}`} title={cellTitle(cell, c.name, t)}>
                            {cell.s === "res" && cell.first && <><b>{cell.code}</b> {cell.who.split(" ")[0]}</>}
                            {cell.s === "block" && (i === 0 || day.cells[c.id]![i - 1]!.s !== "block") && cell.reason}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
