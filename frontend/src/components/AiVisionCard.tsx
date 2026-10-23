import { Arrow } from "./Icons";

const URL = "https://aivision.gplansis.com/?utm_source=padel-lobby&utm_medium=card&utm_campaign=padel";

const POINTS = [
  "Rastreamento de atletas e bola com mapa da quadra",
  "Relatórios de biomecânica: postura, golpes e deslocamento",
  "Desempenho por partida e evolução de cada atleta",
];

/** Quadra vista de cima com um atleta em pose (esqueleto) e a trajetória da bola — a "leitura" da IA. */
function CourtScan({ compact }: { compact?: boolean }) {
  return (
    <svg viewBox="0 0 220 150" role="img" aria-label="Ilustração: quadra de padel com atleta e bola rastreados pela IA"
      style={{ width: compact ? 132 : "100%", maxWidth: 300, height: "auto", flex: "none" }}>
      <rect x="10" y="8" width="200" height="134" rx="8" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <line x1="110" y1="8" x2="110" y2="142" stroke="rgba(255,255,255,0.55)" strokeWidth="2" />
      <line x1="45" y1="8" x2="45" y2="142" stroke="rgba(255,255,255,0.25)" />
      <line x1="175" y1="8" x2="175" y2="142" stroke="rgba(255,255,255,0.25)" />
      <line x1="45" y1="75" x2="175" y2="75" stroke="rgba(255,255,255,0.25)" />
      {/* trajetória da bola */}
      <path d="M150 112 Q 120 40 78 58" fill="none" stroke="var(--ball)" strokeWidth="2" strokeDasharray="4 4" />
      <circle cx="78" cy="58" r="5" fill="var(--ball)" />
      {/* caixa de detecção + esqueleto */}
      <rect x="138" y="70" width="40" height="66" rx="4" fill="none" stroke="#4ADE80" strokeWidth="1.5" />
      <text x="138" y="66" fill="#4ADE80" fontSize="8" fontWeight="800" fontFamily="var(--font)">atleta 0.97</text>
      <g stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="#fff">
        <circle cx="158" cy="80" r="4" stroke="none" />
        <line x1="158" y1="85" x2="157" y2="106" />
        <line x1="158" y1="90" x2="146" y2="98" /><line x1="146" y1="98" x2="150" y2="110" />
        <line x1="158" y1="90" x2="170" y2="84" /><line x1="170" y1="84" x2="174" y2="74" />
        <line x1="157" y1="106" x2="149" y2="120" /><line x1="149" y1="120" x2="146" y2="132" />
        <line x1="157" y1="106" x2="166" y2="119" /><line x1="166" y1="119" x2="170" y2="132" />
      </g>
      {[[158, 90], [146, 98], [170, 84], [157, 106], [149, 120], [166, 119]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2.4" fill="var(--ball)" />
      ))}
      <text x="18" y="22" fill="rgba(255,255,255,0.75)" fontSize="8" fontWeight="700" fontFamily="var(--font)">bola 18 km/h</text>
      <text x="18" y="33" fill="rgba(255,255,255,0.75)" fontSize="8" fontWeight="700" fontFamily="var(--font)">joelho 128°</text>
    </svg>
  );
}

/** CTA para o GPlanSiS|iaVision. `compact` é a versão do app mobile e do perfil. */
export function AiVisionCard({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`aiv-card${compact ? " compact" : ""}`} aria-labelledby={compact ? "aiv-t-m" : "aiv-t"}>
      <div className="aiv-body">
        <p className="aiv-eyebrow">GPlanSiS | iaVision · visão computacional</p>
        <h2 id={compact ? "aiv-t-m" : "aiv-t"} className="aiv-title">
          Seu jogo analisado por <span style={{ color: "var(--ball)" }}>IA</span>
        </h2>
        <p className="aiv-text">
          Análise de atletas e partidas de padel {compact ? "" : "com visão computacional "}— <strong>ao vivo</strong> na quadra (online) ou a partir de <strong>vídeos gravados</strong> (offline).
        </p>
        {!compact && (
          <ul className="aiv-list">
            {POINTS.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <a className="btn btn-ball" href={URL} target="_blank" rel="noopener" aria-label="Conhecer o iaVision (abre em nova aba)">
          {compact ? "Relatórios de biomecânica e desempenho" : "Conhecer o iaVision"} <Arrow size={16} />
        </a>
      </div>
      <CourtScan compact={compact} />
    </section>
  );
}
