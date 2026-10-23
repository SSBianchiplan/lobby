export type User = { id: number; name: string; email: string; phone: string | null; role: "player" | "admin" };

export type Court = { id: number; number: number; name: string; description: string; surface?: string };

export type Club = {
  club_name: string; address: string; district: string; maps_url: string; email: string; whatsapp: string;
  amenities: string[]; promo_text: string; durations: number[]; booking_horizon_days: number;
  cancel_free_hours: number; pending_hold_minutes: number; max_players: number; today: string;
  courts: Court[]; hours: { weekday: number; opens: string; closes: string }[];
  prices: { label: string; weekdays: number[]; holidays: boolean; starts: string; ends: string; cents_per_hour: number; is_promo: boolean }[];
};

export type CalendarDay = { date: string; weekday: string; day: number; open: boolean; holiday: string | null; free: number };

export type SlotStatus = "free" | "busy" | "blocked" | "past" | "nofit" | "closed";
export type Slot = { court_id: number; status: SlotStatus; mine: boolean; price_cents: number; promo: boolean };
export type AvailabilityRow = { time: string; break: boolean; until?: string; slots: Slot[] };
export type Availability = {
  date: string; weekday: string; duration: number; holiday: string | null; open: boolean;
  intervals: [string, string][]; courts: Court[]; rows: AvailabilityRow[];
};

export type Quote = { cents: number; promo: boolean; lines: { label: string; minutes: number; cents: number; cents_per_hour: number }[] };

export type Reservation = {
  code: string; court: Court; date: string; weekday: string; start: string; end: string; starts_at: string; ends_at: string;
  duration: number; status: "pending" | "confirmed" | "checked_in" | "completed" | "cancelled" | "expired";
  payment_method: "pix" | "card" | "onsite"; payment_status: "pending" | "paid" | "onsite" | "refunded" | "void";
  price_cents: number; per_player_cents: number; max_players: number; owner_name: string; is_owner: boolean;
  players: { id: number; name: string; is_owner: boolean; is_you: boolean }[];
  hold_expires_at: string | null; checked_in_at: string | null; cancelled_at: string | null;
  free_cancel_until: string; can_cancel: boolean; free_cancel: boolean; invite_token?: string;
  pix?: { payload: string; txid: string }; owner?: { name: string; email: string; phone: string | null };
};

export type Notification = { id: number; kind: string; title: string; body: string; link: string | null; read: boolean; created_at: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const TOKEN_KEY = "padel.token";
export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* sem storage */ } },
};

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  const res = await fetch(path, { ...init, headers, body });
  if (!res.ok) {
    let msg = "Algo deu errado. Tente de novo.";
    try {
      const data = await res.json();
      if (typeof data.detail === "string") msg = data.detail;
      else if (Array.isArray(data.detail)) msg = data.detail.map((d: { msg: string }) => d.msg).join(" · ");
    } catch { /* corpo não-JSON */ }
    if (res.status === 401 && token) tokenStore.set(null);
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") || "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}
