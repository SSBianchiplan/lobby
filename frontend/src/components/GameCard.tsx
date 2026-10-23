import { Arrow } from "./Icons";

/** CTA do jogo 3D GPlanSiS|PADEL (servido em /jogo/), com uma cena real do jogo. `compact` é a versão do app mobile. */
export function GameCard({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`aiv-card game-card${compact ? " compact" : ""}`} aria-labelledby={compact ? "game-t-m" : "game-t"}>
      <img className="game-shot" src="/quadras/jogo-1400.webp" srcSet="/quadras/jogo-720.webp 720w, /quadras/jogo-1400.webp 1400w"
        sizes={compact ? "100vw" : "(max-width: 700px) 100vw, 60vw"} width={1400} height={788} loading="lazy" decoding="async"
        alt="Cena do jogo: partida de duplas na quadra 3D com as placas do Padel Lobby" />
      <div className="aiv-body">
        <p className="aiv-eyebrow">GPlanSiS | PADEL · jogo 3D</p>
        <h2 id={compact ? "game-t-m" : "game-t"} className="aiv-title">
          Jogue padel <span style={{ color: "var(--ball)" }}>agora</span>
        </h2>
        <p className="aiv-text">
          A quadra em escala real — vidro, grade e rede — {compact ? "no celular." : "com placar, replay e treinador. Funciona no navegador e no celular."}
        </p>
        <a className="btn btn-ball" href="/jogo/" aria-label="Jogar o GPlanSiS|PADEL 3D">
          Jogar <Arrow size={16} />
        </a>
      </div>
    </section>
  );
}
