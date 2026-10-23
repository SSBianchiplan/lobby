export const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const parseDay = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const weekdayShort = (iso: string) => WD[parseDay(iso).getDay()];
/** "Sex 23/10" */
export const dayLabel = (iso: string) => { const d = parseDay(iso); return `${WD[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
/** "Sex, 23 out" */
export const dayLong = (iso: string) => { const d = parseDay(iso); return `${WD[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const addMinutes = (hhmm: string, min: number) => {
  const [h, m] = hhmm.split(":").map(Number); const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
export const relativeDay = (iso: string, today: string) => {
  const diff = Math.round((parseDay(iso).getTime() - parseDay(today).getTime()) / 86400000);
  return diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : dayLabel(iso);
};

export const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "Aguardando pagamento", cls: "badge-cream" },
  confirmed: { text: "Confirmada", cls: "badge-ball" },
  checked_in: { text: "Em quadra", cls: "badge-ok" },
  completed: { text: "Jogada", cls: "badge-ok" },
  cancelled: { text: "Cancelada", cls: "badge-off" },
  expired: { text: "Expirada", cls: "badge-off" },
};
export const LEVEL_LABEL: Record<string, string> = {
  iniciante: "Iniciante", "6": "6ª categoria", "5": "5ª categoria", "4": "4ª categoria", "3": "3ª categoria", "2": "2ª categoria", "1": "1ª categoria",
};
export const SIDE_LABEL: Record<string, string> = { direita: "Direita (drive)", esquerda: "Esquerda (revés)", ambos: "Os dois lados" };
export const HAND_LABEL: Record<string, string> = { destro: "Destro", canhoto: "Canhoto" };
export const PAY_LABEL: Record<string, string> = { pix: "Pix", card: "Cartão", onsite: "No local" };

/** Conteúdo do QR de check-in: um link (a câmera comum do celular abre algo útil) com o código da reserva. */
export const checkinUrl = (code: string) => `${location.origin}/checkin/${code}`;
/** Extrai o código PL-XXXXX de um QR (link novo ou código puro dos QRs antigos). */
export const parseCheckinCode = (text: string) => text.toUpperCase().match(/PL-[23456789A-HJ-NP-Z]{5}/)?.[0] ?? null;
