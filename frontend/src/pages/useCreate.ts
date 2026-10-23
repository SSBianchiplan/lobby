import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type Quote, type Reservation } from "../api";
import { useAuth } from "../auth";
import { useBooking } from "../booking";
import { useToast } from "../components/Toast";

export function useQuote() {
  const { draft } = useBooking();
  const ready = !!(draft.date && draft.start && draft.courtId);
  return useQuery({
    queryKey: ["quote", draft.courtId, draft.date, draft.start, draft.duration],
    queryFn: () => api<Quote>(`/api/quote?court_id=${draft.courtId}&date=${draft.date}&start=${draft.start}&duration=${draft.duration}`),
    enabled: ready,
  });
}

/** Cria a reserva a partir do rascunho; sem login, manda para /entrar e volta. */
export function useCreateReservation(returnTo: string) {
  const { draft, reset } = useBooking();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api<Reservation>("/api/reservations", {
      method: "POST",
      json: { court_id: draft.courtId, date: draft.date, start: draft.start, duration: draft.duration, payment_method: draft.method, players: draft.guests },
    }),
    onSuccess: (r) => {
      navigate(`/reservas/${r.code}`);
      // limpa o rascunho só depois da navegação, senão a tela de confirmação redireciona para /agenda
      setTimeout(reset, 0);
      qc.invalidateQueries({ queryKey: ["availability"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["mine"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast(r.status === "pending" ? "Reserva criada! Pague o Pix para confirmar." : "Reserva confirmada!");
    },
    onError: (e) => {
      toast(e instanceof ApiError ? e.message : "Não foi possível reservar.");
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ["availability"] });
    },
  });
  return {
    ...m,
    submit: () => {
      if (!user) { navigate(`/entrar?next=${encodeURIComponent(returnTo)}`); return; }
      m.mutate();
    },
  };
}
