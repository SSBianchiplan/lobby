import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Availability, type CalendarDay, type Club } from "./api";

export function useIsMobile() {
  const q = "(max-width: 760px)";
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

export const useClub = () => useQuery({ queryKey: ["club"], queryFn: () => api<Club>("/api/club"), staleTime: 5 * 60_000 });

export const useCalendar = (days = 7) =>
  useQuery({ queryKey: ["calendar", days], queryFn: () => api<CalendarDay[]>(`/api/calendar?days=${days}`), refetchInterval: 60_000 });

export const useAvailability = (date: string | null, duration: number) =>
  useQuery({
    queryKey: ["availability", date, duration],
    queryFn: () => api<Availability>(`/api/availability?date=${date}&duration=${duration}`),
    enabled: !!date,
    refetchInterval: 30_000,
  });

/** Primeiro dia aberto do calendário (ou o escolhido, se ainda válido). */
export function pickDay(days: CalendarDay[] | undefined, current: string | null) {
  if (!days?.length) return current;
  if (current && days.some((d) => d.date === current && d.open)) return current;
  return days.find((d) => d.open && d.free > 0)?.date ?? days.find((d) => d.open)?.date ?? days[0]!.date;
}

export function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const ms = Math.max(0, new Date(until).getTime() - now);
  return { ms, label: `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}` };
}
