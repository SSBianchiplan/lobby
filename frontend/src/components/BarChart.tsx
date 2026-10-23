import { useMemo, useRef, useState, type KeyboardEvent } from "react";

export type BarDatum = { key: string; label: string; value: number; detail?: string; value2?: number };

/** Ticks "redondos" para o eixo Y (1, 2, 2,5 ou 5 × 10ⁿ). */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

/**
 * Gráfico de barras interativo: eixo Y com valores, grade discreta, média, dica por barra (mouse, foco e toque),
 * segunda série opcional como linha (mesmo eixo) e clique para abrir o item.
 */
export function BarChart({ data, format, short = format, height = 200, series = "Valor", series2, onSelect, selectHint, average = true }: {
  data: BarDatum[]; format: (n: number) => string; short?: (n: number) => string; height?: number;
  series?: string; series2?: string; onSelect?: (key: string) => void; selectHint?: string; average?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const touch = useRef(false);
  const wasActive = useRef(false);  // a barra já mostrava a dica antes deste toque?
  const ticks = useMemo(() => niceTicks(Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 ?? 0)))), [data]);
  const top = ticks[ticks.length - 1]!;
  const avg = data.length ? data.reduce((s, d) => s + d.value, 0) / data.length : 0;
  const narrow = typeof window !== "undefined" && window.innerWidth < 600;
  const every = Math.max(1, Math.ceil(data.length / (narrow ? 5 : 10)));  // rótulos do eixo X sem encavalar
  if (!data.length) return <p className="empty">Sem dados no período.</p>;
  const y = (v: number) => (v / top) * 100;
  const a = active !== null ? data[active] : null;

  const pick = (i: number) => {
    // toque: 1º mostra o valor, 2º abre; mouse/teclado: clique abre direto
    if (touch.current && !wasActive.current) { setActive(i); return; }
    if (onSelect) onSelect(data[i]!.key);
  };
  const keys = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (next !== null && next >= 0 && next < data.length) {
      e.preventDefault();
      (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
    }
  };

  return (
    <figure className="bc" style={{ margin: 0 }}>
      {series2 && (
        <figcaption className="bc-legend">
          <span><i className="bc-key bar" />{series}</span>
          <span><i className="bc-key line" />{series2}</span>
          {average && <span><i className="bc-key avg" />Média</span>}
        </figcaption>
      )}
      <div className="bc-plot" style={{ height }} onPointerLeave={() => { if (!touch.current) setActive(null); }}>
        <div className="bc-axis" aria-hidden="true">
          {ticks.map((t) => <span key={t} style={{ bottom: `${y(t)}%` }}>{short(t)}</span>)}
        </div>
        <div className="bc-area">
          {ticks.map((t) => <i key={t} className="bc-grid" style={{ bottom: `${y(t)}%` }} aria-hidden="true" />)}
          {average && avg > 0 && <i className="bc-avg" style={{ bottom: `${y(avg)}%` }} title={`Média ${format(avg)}`} aria-hidden="true" />}
          {series2 && (
            <svg className="bc-line" viewBox={`0 0 ${data.length} 100`} preserveAspectRatio="none" aria-hidden="true">
              <polyline points={data.map((d, i) => `${i + 0.5},${100 - y(d.value2 ?? 0)}`).join(" ")} />
            </svg>
          )}
          <div className="bc-bars" role="list" aria-label={`${series} por item`}>
            {data.map((d, i) => (
              <button key={d.key} type="button" role="listitem" className={`bc-bar${active === i ? " on" : ""}`}
                aria-label={`${d.label}: ${format(d.value)}${d.value2 !== undefined && series2 ? `, ${series2.toLowerCase()} ${d.value2}` : ""}${d.detail ? `, ${d.detail}` : ""}`}
                onPointerDown={(e) => { touch.current = e.pointerType === "touch"; wasActive.current = active === i; }}
                onPointerEnter={(e) => { if (e.pointerType !== "touch") setActive(i); }}
                onFocus={() => setActive(i)} onBlur={() => { if (!touch.current) setActive(null); }}
                onClick={() => pick(i)} onKeyDown={(e) => keys(e, i)}>
                <i style={{ height: `${Math.max(d.value > 0 ? 1.5 : 0, y(d.value))}%` }} />
              </button>
            ))}
          </div>
          {a && active !== null && (
            <div className="bc-tip" role="status" style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
              data-side={active / data.length > 0.66 ? "left" : active / data.length < 0.2 ? "right" : "center"}>
              <strong>{format(a.value)}</strong>
              <span>{a.label}</span>
              {a.value2 !== undefined && series2 && <span><i className="bc-key line" />{a.value2} {series2.toLowerCase()}</span>}
              {a.detail && <span>{a.detail}</span>}
              {onSelect && <em>{touch.current ? "toque de novo para abrir" : (selectHint ?? "clique para abrir")}</em>}
            </div>
          )}
        </div>
      </div>
      <div className="bc-x" aria-hidden="true">
        {data.map((d, i) => <span key={d.key}>{i % every === 0 ? d.label.split(" ").slice(-1)[0] : ""}</span>)}
      </div>
    </figure>
  );
}
