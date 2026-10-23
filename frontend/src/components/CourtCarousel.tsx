import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryPhoto } from "../api";
import { photoSrcSet } from "../format";

const INTERVAL_MS = 5500;

/**
 * Carrossel das quadras com movimento: fade cruzado + "Ken Burns" (zoom e panorâmica lentos, um sentido por foto).
 * Pausa com o mouse em cima, com foco dentro, com a aba escondida e para quem pede menos movimento no sistema.
 */
export function CourtCarousel({ photos, compact = false, caption }: { photos: GalleryPhoto[]; compact?: boolean; caption?: string }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const touch = useRef<number | null>(null);
  const n = photos.length;
  const go = useCallback((k: number) => setI(((k % n) + n) % n), [n]);

  useEffect(() => {
    if (n < 2 || paused || reduced.current) return;
    const t = setTimeout(() => go(i + 1), INTERVAL_MS);
    return () => clearTimeout(t);
  }, [i, n, paused, go]);
  useEffect(() => {
    const vis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  if (!n) return null;
  return (
    <section className={`carousel${compact ? " compact" : ""}`} aria-roledescription="carrossel" aria-label="Fotos das quadras"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onKeyDown={(e) => { if (e.key === "ArrowRight") go(i + 1); if (e.key === "ArrowLeft") go(i - 1); }}
      onTouchStart={(e) => { touch.current = e.touches[0]!.clientX; }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0]!.clientX - touch.current; touch.current = null;
        if (Math.abs(dx) > 40) go(dx < 0 ? i + 1 : i - 1);
      }}>
      {photos.map((p, k) => (
        <figure key={p.src} className={`carousel-slide${k === i ? " on" : ""} kb-${k % 4}`} aria-hidden={k !== i}
          role="group" aria-roledescription="slide" aria-label={`${k + 1} de ${n}`}>
          <img src={p.src.replace("-1600.webp", "-800.webp")} srcSet={photoSrcSet(p.src)} sizes={compact ? "100vw" : "(max-width: 1200px) 100vw, 1200px"}
            alt={p.alt} loading={k === 0 ? "eager" : "lazy"} decoding="async" draggable={false} />
        </figure>
      ))}
      <div className="carousel-shade" aria-hidden="true" />
      <div className="carousel-caption">
        {caption && <p className="carousel-eyebrow">{caption}</p>}
        <p className="carousel-alt" aria-live={paused ? "polite" : "off"}>{photos[i]!.alt}</p>
      </div>
      {n > 1 && (
        <>
          <button type="button" className="carousel-nav prev" onClick={() => go(i - 1)} aria-label="Foto anterior">‹</button>
          <button type="button" className="carousel-nav next" onClick={() => go(i + 1)} aria-label="Próxima foto">›</button>
          <div className="carousel-dots" role="group" aria-label="Escolher foto">
            {photos.map((p, k) => (
              <button key={p.src} type="button" aria-label={`Foto ${k + 1}`} aria-current={k === i} onClick={() => go(k)}>
                {k === i && !paused && !reduced.current && <i style={{ animationDuration: `${INTERVAL_MS}ms` }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
