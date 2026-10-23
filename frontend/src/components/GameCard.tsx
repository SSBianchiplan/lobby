import { Arrow } from "./Icons";

/** Quadra em perspectiva (a mesma 20 × 10 m do jogo), com a placa de patrocínio do clube. */
function Court3D({ compact }: { compact: boolean }) {
  return (
    <svg viewBox="0 0 220 140" width={compact ? 120 : 240} height={compact ? 76 : 152} aria-hidden="true" style={{ flex: "none" }}>
      <polygon points="40,128 180,128 152,34 68,34" fill="#1f43b8" stroke="#fff" strokeWidth="2" />
      <line x1="110" y1="34" x2="110" y2="128" stroke="#fff" strokeWidth="1.5" />
      <line x1="56" y1="92" x2="164" y2="92" stroke="#fff" strokeWidth="1.5" />
      <line x1="63" y1="58" x2="157" y2="58" stroke="#fff" strokeWidth="1.5" />
      <line x1="52" y1="74" x2="168" y2="74" stroke="#d9f24a" strokeWidth="3" />
      <rect x="72" y="14" width="76" height="14" rx="3" fill="#fff" />
      <text x="110" y="24.5" textAnchor="middle" fontSize="9" fontWeight="900" fill="#D7362A" fontFamily="var(--font)">PADEL LOBBY</text>
      <circle cx="138" cy="104" r="6" fill="#d9f24a" />
    </svg>
  );
}

/** CTA do jogo 3D GPlanSiS|PADEL (servido em /jogo/). `compact` é a versão do app mobile. */
export function GameCard({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`aiv-card game-card${compact ? " compact" : ""}`} aria-labelledby={compact ? "game-t-m" : "game-t"}>
      <div className="aiv-body">
        <p className="aiv-eyebrow">GPlanSiS | PADEL · jogo 3D</p>
        <h2 id={compact ? "game-t-m" : "game-t"} className="aiv-title">
          Jogue padel <span style={{ color: "var(--ball)" }}>agora</span>
        </h2>
        <p className="aiv-text">
          A quadra em escala real — vidro, grade e rede — {compact ? "no celular." : "com placar, replay e modo demonstração. Funciona no navegador e no celular."}
        </p>
        <a className="btn btn-ball" href="/jogo/" aria-label="Jogar o GPlanSiS|PADEL 3D">
          Jogar <Arrow size={16} />
        </a>
      </div>
      <Court3D compact={compact} />
    </section>
  );
}
