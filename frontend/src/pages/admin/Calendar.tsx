import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Spinner } from "../../components/Layout";
import { isoDay, money } from "../../format";
import { useIsMobile } from "../../hooks";
import { SessionModal } from "./Classes";
import { PAY_STATUS } from "./shared";
import { BlockModal, ReservationModal, SlotModal, type SlotTarget } from "./SlotModals";

type View = "day" | "week" | "month";
type Court = { id: number; number: number; name: string };
type Day = { date: string; open: boolean; holiday: string | null; intervals: [string, string][] };
type Ev = {
  type: "reservation" | "class" | "block"; id: string | number; court_id: number | null; start: string; end: string;
  title: string; subtitle: string; status?: string; pay?: string; price_cents?: number; players?: number;
  color?: string; coach_id?: number; started?: boolean; present?: number; expected?: number;
};
type Data = { courts: Court[]; days: Day[]; events: Ev[]; now: string };

const WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const parse = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y!, m! - 1, d!); };
const add = (iso: string, n: number) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoDay(d); };
const monday = (iso: string) => { const d = parse(iso); return add(iso, -((d.getDay() + 6) % 7)); };
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
const minOfDay = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const dayOf = (iso: string) => isoDay(new Date(iso));

function range(view: View, anchor: string): [string, string] {
  if (view === "day") return [anchor, add(anchor, 1)];
  if (view === "week") { const m = monday(anchor); return [m, add(m, 7)]; }
  const first = anchor.slice(0, 8) + "01";
  const s = monday(first);
  return [s, add(s, 42)];
}

function title(view: View, anchor: string) {
  const d = parse(anchor);
  if (view === "day") return `${WD[(d.getDay() + 6) % 7]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  if (view === "month") return `${MONTHS[d.getMonth()]![0]!.toUpperCase()}${MONTHS[d.getMonth()]!.slice(1)} ${d.getFullYear()}`;
  const [s] = range("week", anchor); const a = parse(s); const b = parse(add(s, 6));
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} de ${MONTHS[a.getMonth()]}` : `${a.getDate()} ${MONTHS[a.getMonth()]!.slice(0, 3)} – ${b.getDate()} ${MONTHS[b.getMonth()]!.slice(0, 3)}`;
}

function evClass(e: Ev) {
  if (e.type === "block") return "cal-ev block";
  if (e.type === "class") return "cal-ev class";
  if (e.status === "pending") return "cal-ev pending";
  if (e.status === "checked_in") return "cal-ev live";
  return e.pay === "onsite" ? "cal-ev open" : "cal-ev paid";
}

/** Calendário avançado do admin: Dia (quadras em colunas), Semana (dias com faixas por quadra) e Mês (ocupação). */
export default function Calendar() {
  const mobile = useIsMobile();
  const [view, setView] = useState<View>(() => (window.innerWidth <= 760 ? "day" : "week"));
  const [anchor, setAnchor] = useState(() => isoDay(new Date()));
  const [court, setCourt] = useState<number | "">("");
  const [types, setTypes] = useState({ reservation: true, class: true, block: true });
  const [start, end] = range(view, anchor);
  const q = useQuery({
    queryKey: ["admin", "calendar", start, end, court],
    queryFn: () => api<Data>(`/api/admin/calendar?start=${start}&end=${end}${court ? `&court_id=${court}` : ""}`),
    placeholderData: keepPreviousData, refetchInterval: 30_000,
  });
  const [slot, setSlot] = useState<SlotTarget | null>(null);
  const [resCode, setResCode] = useState<string | null>(null);
  const [lesson, setLesson] = useState<number | null>(null);
  const [block, setBlock] = useState<{ id: number; reason: string; label: string } | null>(null);

  const d = q.data;
  const events = useMemo(() => (d?.events ?? []).filter((e) => types[e.type]), [d, types]);
  const courts = useMemo(() => (d?.courts ?? []).filter((c) => !court || c.id === court), [d, court]);
  const step = (dir: number) => setAnchor(view === "day" ? add(anchor, dir) : view === "week" ? add(anchor, 7 * dir) : (() => { const x = parse(anchor); x.setMonth(x.getMonth() + dir, 1); return isoDay(x); })());

  const openEvent = (e: Ev) => {
    if (e.type === "reservation") setResCode(String(e.id));
    else if (e.type === "class") setLesson(Number(e.id));
    else setBlock({ id: Number(e.id), reason: e.title, label: `${dayOf(e.start).split("-").reverse().slice(0, 2).join("/")} · ${hhmm(minOfDay(e.start))}–${hhmm(minOfDay(e.end))}` });
  };

  /** Clique num espaço livre: abre reservar/bloquear com os minutos livres até o próximo evento ou o fim do expediente. */
  const openSlot = (day: Day, c: Court, minute: number) => {
    const t = Math.floor(minute / 30) * 30;
    const iv = day.intervals.map(([o, cl]) => [toMin(o), toMin(cl)] as const).find(([o, cl]) => t >= o && t < cl);
    if (!iv) return;
    const startDate = new Date(`${day.date}T${hhmm(t)}:00`);
    if (startDate.getTime() <= Date.now()) return;
    const busy = (d?.events ?? []).filter((e) => dayOf(e.start) === day.date && (e.court_id === c.id || e.court_id === null));
    if (busy.some((e) => minOfDay(e.start) <= t && t < (dayOf(e.end) === day.date ? minOfDay(e.end) : 1440))) return;
    const nextStart = Math.min(iv[1], ...busy.map((e) => minOfDay(e.start)).filter((m) => m > t));
    const dayTimes: string[] = [];
    for (const [o, cl] of day.intervals) for (let m = toMin(o); m < toMin(cl); m += 30) dayTimes.push(hhmm(m));
    setSlot({ courtId: c.id, courtName: c.name, date: day.date, time: hhmm(t), dayTimes, freeMinutes: nextStart - t });
  };

  return (
    <div className="stack gap-14">
      <div className="cal-toolbar">
        <div className="chips" role="group" aria-label="Navegar">
          <button onClick={() => step(-1)} aria-label="Anterior">‹</button>
          <button onClick={() => setAnchor(isoDay(new Date()))}>Hoje</button>
          <button onClick={() => step(1)} aria-label="Próximo">›</button>
        </div>
        <h2 className="italic-title cal-title">{title(view, anchor)}</h2>
        <div className="segmented" role="tablist" aria-label="Visão">
          {([["day", "Dia"], ["week", "Semana"], ["month", "Mês"]] as const).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={view === v} aria-pressed={view === v} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="cal-filters">
        <select className="select" style={{ height: 40, width: 200 }} value={court} onChange={(e) => setCourt(e.target.value ? Number(e.target.value) : "")} aria-label="Quadra">
          <option value="">Todas as quadras</option>
          {d?.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {([["reservation", "Reservas", "paid"], ["class", "Aulas", "class"], ["block", "Bloqueios", "block"]] as const).map(([k, l, cls]) => (
          <label key={k} className="cal-toggle"><input type="checkbox" checked={types[k]} onChange={(e) => setTypes({ ...types, [k]: e.target.checked })} />
            <i className={`cal-ev ${cls}`} aria-hidden="true" />{l}</label>
        ))}
        <ul className="cal-legend" aria-label="Legenda">
          <li><i className="cal-ev paid" />Pago</li><li><i className="cal-ev open" />A receber</li><li><i className="cal-ev pending" />Aguardando Pix</li><li><i className="cal-ev live" />Em quadra</li>
        </ul>
      </div>

      {!d ? <Spinner /> : view === "month"
        ? <MonthView data={d} events={events} courts={courts} anchor={anchor} onDay={(day) => { setAnchor(day); setView("day"); }} />
        : <TimeGrid view={view} data={d} events={events} courts={courts} mobile={mobile} onEvent={openEvent} onSlot={openSlot}
            onDay={(day) => { setAnchor(day); setView("day"); }} />}

      <SlotModal target={slot} onClose={() => setSlot(null)} />
      <ReservationModal code={resCode} onClose={() => setResCode(null)} />
      <SessionModal id={lesson} onClose={() => setLesson(null)} />
      <BlockModal block={block} onClose={() => setBlock(null)} />
    </div>
  );
}

// ── Dia e Semana: grade de horário ──────────────────────────────────────────

function TimeGrid({ view, data, events, courts, mobile, onEvent, onSlot, onDay }: {
  view: "day" | "week"; data: Data; events: Ev[]; courts: Court[]; mobile: boolean;
  onEvent: (e: Ev) => void; onSlot: (day: Day, c: Court, minute: number) => void; onDay: (iso: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const days = view === "day" ? data.days.slice(0, 1) : data.days;
  const open = days.flatMap((d) => d.intervals.map(([o, c]) => [toMin(o), toMin(c)]));
  const from = Math.floor((open.length ? Math.min(...open.map((x) => x[0]!)) : 8 * 60) / 60) * 60;
  const to = Math.ceil((open.length ? Math.max(...open.map((x) => x[1]!)) : 23 * 60) / 60) * 60;
  const ppm = view === "day" ? 1.3 : 1;   // pixels por minuto
  const H = (to - from) * ppm;
  const today = isoDay(new Date());
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  useEffect(() => {  // começa perto da hora atual
    if (scroller.current && days.some((d) => d.date === today)) scroller.current.scrollTop = Math.max(0, (nowMin - from - 90) * ppm);
  }, [view, days.length]);
  const lanes = courts.length || 1;
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from + i * 60);
  const colMin = view === "day" ? (mobile ? 130 : 160) : (lanes > 1 ? 150 : 110);

  return (
    <div className="cal-wrap card" style={{ boxShadow: "none" }}>
      <div className="cal-scroll" ref={scroller} style={{ maxHeight: mobile ? "70dvh" : "74dvh" }}>
        <div className="cal-grid" style={{ gridTemplateColumns: `52px repeat(${view === "day" ? courts.length : days.length}, minmax(${colMin}px, 1fr))` }}>
          {/* cabeçalhos */}
          <div className="cal-corner" />
          {view === "day"
            ? courts.map((c) => <div key={c.id} className="cal-head"><strong>{c.name}</strong><small>{days[0]?.holiday ?? ""}</small></div>)
            : days.map((d) => {
              const dt = parse(d.date);
              return (
                <button key={d.date} type="button" className={`cal-head${d.date === today ? " today" : ""}`} onClick={() => onDay(d.date)}>
                  <small>{WD[(dt.getDay() + 6) % 7]}</small><strong>{dt.getDate()}</strong>
                  {lanes > 1 && <span className="cal-lanes">{courts.map((c) => <i key={c.id}>Q{c.number}</i>)}</span>}
                  {d.holiday && <em>{d.holiday}</em>}
                </button>
              );
            })}
          {/* eixo de horas */}
          <div className="cal-axis" style={{ height: H }}>
            {hours.map((h) => <span key={h} style={{ top: (h - from) * ppm }}>{hhmm(h)}</span>)}
          </div>
          {/* colunas */}
          {(view === "day" ? courts.map((c) => ({ day: days[0]!, courts: [c] })) : days.map((d) => ({ day: d, courts }))).map(({ day, courts: cs }, ci) => {
            const dayEvents = events.filter((e) => dayOf(e.start) === day.date && (e.court_id === null || cs.some((c) => c.id === e.court_id)));
            const closed = [] as [number, number][];
            let cur = from;
            for (const [o, c] of day.intervals.map(([o, c]) => [toMin(o), toMin(c)] as const).sort((a, b) => a[0] - b[0])) { if (o > cur) closed.push([cur, o]); cur = Math.max(cur, c); }
            if (cur < to) closed.push([cur, to]);
            const click = (ev: MouseEvent<HTMLDivElement>) => {
              if (ev.target !== ev.currentTarget) return;
              const r = ev.currentTarget.getBoundingClientRect();
              const minute = from + (ev.clientY - r.top) / ppm;
              const lane = cs.length > 1 ? Math.min(cs.length - 1, Math.floor(((ev.clientX - r.left) / r.width) * cs.length)) : 0;
              onSlot(day, cs[lane]!, minute);
            };
            return (
              <div key={`${day.date}-${ci}`} className={`cal-col${day.date === today ? " today" : ""}`} style={{ height: H, backgroundSize: `100% ${60 * ppm}px` }} onClick={click}
                role="presentation" title="Clique num horário livre para reservar ou bloquear">
                {closed.map(([a, b]) => <div key={a} className="cal-closed" style={{ top: (a - from) * ppm, height: (b - a) * ppm }} />)}
                {!day.open && <div className="cal-closed-label">Fechado{day.holiday ? ` · ${day.holiday}` : ""}</div>}
                {dayEvents.map((e) => {
                  const s = Math.max(from, minOfDay(e.start));
                  const en = Math.min(to, dayOf(e.end) === day.date ? minOfDay(e.end) || 1440 : 1440);
                  const lane = e.court_id === null ? -1 : cs.findIndex((c) => c.id === e.court_id);
                  const style: CSSProperties = {
                    top: (s - from) * ppm, height: Math.max(18, (en - s) * ppm - 2),
                    left: lane < 0 || cs.length === 1 ? 2 : `calc(${(lane / cs.length) * 100}% + 1px)`,
                    width: lane < 0 || cs.length === 1 ? "calc(100% - 4px)" : `calc(${100 / cs.length}% - 2px)`,
                    ...(e.type === "class" && e.color ? { ["--coach" as string]: e.color } : {}),
                  };
                  const tall = (en - s) * ppm >= 40;
                  return (
                    <button key={`${e.type}-${e.id}`} type="button" className={evClass(e)} style={style} onClick={() => onEvent(e)}
                      title={`${hhmm(minOfDay(e.start))}–${hhmm(minOfDay(e.end))} · ${e.title} · ${e.subtitle}${e.pay ? ` · ${PAY_STATUS[e.pay]?.text}` : ""}`}>
                      <b>{e.type === "class" ? "Aula · " : ""}{view === "week" && cs.length > 1 && e.type === "reservation" ? e.title.split(" ")[0] : e.title}</b>
                      {tall && <small>{hhmm(minOfDay(e.start))}–{hhmm(minOfDay(e.end))}{e.type === "class" ? ` · ${e.present}/${e.expected}` : ` · ${e.subtitle}`}</small>}
                    </button>
                  );
                })}
                {day.date === today && nowMin >= from && nowMin <= to && <div className="cal-now" style={{ top: (nowMin - from) * ppm }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Mês ─────────────────────────────────────────────────────────────────────

function MonthView({ data, events, courts, anchor, onDay }: { data: Data; events: Ev[]; courts: Court[]; anchor: string; onDay: (iso: string) => void }) {
  const month = anchor.slice(0, 7);
  const today = isoDay(new Date());
  const byDay = new Map<string, Ev[]>();
  for (const e of events) byDay.set(dayOf(e.start), [...(byDay.get(dayOf(e.start)) ?? []), e]);
  return (
    <div className="cal-month card" style={{ boxShadow: "none" }}>
      {WD.map((w) => <div key={w} className="cal-month-wd">{w}</div>)}
      {data.days.map((day) => {
        const list = byDay.get(day.date) ?? [];
        const openMin = day.intervals.reduce((s, [o, c]) => s + toMin(c) - toMin(o), 0) * Math.max(1, courts.length);
        const busy = list.filter((e) => e.type !== "block").reduce((s, e) => s + (minOfDay(e.end) || 1440) - minOfDay(e.start), 0);
        const occ = openMin ? Math.min(1, busy / openMin) : 0;
        const res = list.filter((e) => e.type === "reservation");
        const cls = list.filter((e) => e.type === "class").length;
        const revenue = res.reduce((s, e) => s + (e.price_cents ?? 0), 0);
        return (
          <button key={day.date} type="button" onClick={() => onDay(day.date)}
            className={`cal-cell${day.date.slice(0, 7) !== month ? " other" : ""}${day.date === today ? " today" : ""}${!day.open ? " closed" : ""}`}>
            <span className="cal-cell-head"><strong>{parse(day.date).getDate()}</strong>{day.holiday && <em>{day.holiday}</em>}</span>
            {day.open ? (
              <>
                <span className="bar" title={`Ocupação ${Math.round(occ * 100)}%`}><i style={{ width: `${occ * 100}%` }} /></span>
                <small className="cal-cell-meta">{Math.round(occ * 100)}% · {res.length} res.{cls ? ` · ${cls} aula${cls > 1 ? "s" : ""}` : ""}</small>
                <span className="cal-cell-evs">
                  {list.slice(0, 3).map((e) => <i key={`${e.type}-${e.id}`} className={evClass(e)} style={e.type === "class" && e.color ? { ["--coach" as string]: e.color } as CSSProperties : undefined}>{hhmm(minOfDay(e.start))} {e.title}</i>)}
                  {list.length > 3 && <small className="muted">+{list.length - 3}</small>}
                </span>
                {revenue > 0 && <small className="cal-cell-rev">{money(revenue)}</small>}
              </>
            ) : <small className="muted">Fechado</small>}
          </button>
        );
      })}
    </div>
  );
}
