import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** Rascunho da reserva compartilhado entre Início, Agenda e Confirmar (sobrevive ao login). */
export type Draft = {
  date: string | null; duration: number; courtId: number | null; start: string | null;
  guests: string[]; method: "pix" | "card" | "onsite";
};

const KEY = "padel.draft";
const EMPTY: Draft = { date: null, duration: 60, courtId: null, start: null, guests: [], method: "pix" };

type Ctx = { draft: Draft; update: (p: Partial<Draft>) => void; reset: () => void };
const BookingCtx = createContext<Ctx | null>(null);

export function BookingProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(() => {
    try { return { ...EMPTY, ...JSON.parse(sessionStorage.getItem(KEY) || "{}") }; } catch { return EMPTY; }
  });
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* sem storage */ } }, [draft]);
  const value: Ctx = {
    draft,
    update: (p) => setDraft((d) => ({ ...d, ...p })),
    reset: () => setDraft((d) => ({ ...EMPTY, method: d.method })),
  };
  return <BookingCtx.Provider value={value}>{children}</BookingCtx.Provider>;
}

export function useBooking() {
  const ctx = useContext(BookingCtx);
  if (!ctx) throw new Error("useBooking fora do BookingProvider");
  return ctx;
}
