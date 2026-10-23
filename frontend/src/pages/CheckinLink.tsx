import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, type Reservation } from "../api";
import { useAuth } from "../auth";
import { Logo, Spinner } from "../components/Layout";
import { dayLabel, STATUS_LABEL } from "../format";

/**
 * Destino do QR da reserva quando lido pela câmera comum do celular.
 * Admin: confirma o check-in (abrir um link não muda nada sozinho). Jogador: vai para a própria reserva.
 */
export default function CheckinLink() {
  const { code = "" } = useParams();
  const { user, ready } = useAuth();
  const isAdmin = user?.role === "admin";
  const q = useQuery({ queryKey: ["checkin-link", code], enabled: isAdmin, queryFn: () => api<Reservation>(`/api/reservations/${code}`) });
  const go = useMutation({ mutationFn: () => api<Reservation>("/api/admin/checkin", { method: "POST", json: { code } }), onSuccess: () => q.refetch() });

  if (!ready) return <Spinner />;
  if (!user) return <Navigate to={`/entrar?next=${encodeURIComponent(`/checkin/${code}`)}`} replace />;
  if (!isAdmin) return <Navigate to={`/reservas/${code}`} replace />;
  const r = q.data;

  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <section className="card card-pad" style={{ width: "100%", maxWidth: 440, boxShadow: "var(--shadow-float)", display: "flex", flexDirection: "column", gap: 14 }}>
        <Logo height={44} />
        <h1 className="italic-title" style={{ fontSize: 26 }}>Check-in <code>{code}</code></h1>
        {q.isLoading ? <Spinner /> : !r ? <p className="form-error">Reserva não encontrada.</p> : (
          <>
            <p style={{ fontSize: 16, fontWeight: 700 }}>{r.owner?.name}<br />
              <span className="muted" style={{ fontWeight: 600 }}>{r.court.name} · {dayLabel(r.date)} · {r.start}–{r.end}</span></p>
            <p><span className={`badge ${STATUS_LABEL[r.status]!.cls}`}>{STATUS_LABEL[r.status]!.text}</span></p>
            {go.error && <p className="form-error" role="alert">{go.error instanceof ApiError ? go.error.message : "Falhou."}</p>}
            {r.status === "confirmed" && <button className="btn btn-primary btn-lg" disabled={go.isPending} onClick={() => go.mutate()}>Confirmar check-in</button>}
            {r.status === "checked_in" && <p className="alert alert-cream" style={{ padding: 12, borderRadius: 12, fontWeight: 700 }}>✓ Check-in feito.</p>}
          </>
        )}
        <Link to="/recepcao" style={{ fontSize: 14, fontWeight: 700 }}>Abrir o leitor da recepção</Link>
      </section>
    </main>
  );
}

/** Destino do QR pessoal do aluno lido pela câmera comum: admin marca presença; os demais vão para o perfil. */
export function StudentLink() {
  const { token = "" } = useParams();
  const { user, ready } = useAuth();
  const go = useMutation({
    mutationFn: () => api<{ user: { name: string }; session: { name: string }; already: boolean }>("/api/admin/classes/checkin", { method: "POST", json: { token } }),
  });
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to={`/entrar?next=${encodeURIComponent(`/aluno/${token}`)}`} replace />;
  if (user.role !== "admin") return <Navigate to="/perfil#aulas" replace />;
  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <section className="card card-pad" style={{ width: "100%", maxWidth: 440, boxShadow: "var(--shadow-float)", display: "flex", flexDirection: "column", gap: 14 }}>
        <Logo height={44} />
        <h1 className="italic-title" style={{ fontSize: 26 }}>Presença na aula</h1>
        {go.data ? <p className="alert alert-cream" style={{ padding: 12, borderRadius: 12, fontWeight: 700 }}>✓ {go.data.user.name} · {go.data.session.name}{go.data.already ? " (já estava presente)" : ""}</p>
          : <button className="btn btn-primary btn-lg" disabled={go.isPending} onClick={() => go.mutate()}>Marcar presença na aula de agora</button>}
        {go.error && <p className="form-error" role="alert">{go.error instanceof ApiError ? go.error.message : "Falhou."}</p>}
        <Link to="/recepcao" style={{ fontSize: 14, fontWeight: 700 }}>Abrir o leitor da recepção</Link>
      </section>
    </main>
  );
}

/** Destino do QR do professor lido pela câmera comum: admin registra a chegada e inicia a aula. */
export function CoachLink() {
  const { token = "" } = useParams();
  const { user, ready } = useAuth();
  const go = useMutation({
    mutationFn: () => api<{ coach: { name: string }; session: { name: string }; already: boolean }>("/api/admin/classes/coach-checkin", { method: "POST", json: { token } }),
  });
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to={`/entrar?next=${encodeURIComponent(`/professor/${token}`)}`} replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <section className="card card-pad" style={{ width: "100%", maxWidth: 440, boxShadow: "var(--shadow-float)", display: "flex", flexDirection: "column", gap: 14 }}>
        <Logo height={44} />
        <h1 className="italic-title" style={{ fontSize: 26 }}>Chegada do professor</h1>
        {go.data ? <p className="alert alert-cream" style={{ padding: 12, borderRadius: 12, fontWeight: 700 }}>✓ {go.data.coach.name} · {go.data.session.name}{go.data.already ? " (aula já estava iniciada)" : " · aula iniciada"}</p>
          : <button className="btn btn-primary btn-lg" disabled={go.isPending} onClick={() => go.mutate()}>Registrar chegada e iniciar a aula</button>}
        {go.error && <p className="form-error" role="alert">{go.error instanceof ApiError ? go.error.message : "Falhou."}</p>}
        <Link to="/recepcao" style={{ fontSize: 14, fontWeight: 700 }}>Abrir o leitor da recepção</Link>
      </section>
    </main>
  );
}
