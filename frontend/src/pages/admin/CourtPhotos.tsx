import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/Toast";
import { useClub } from "../../hooks";

/** Escolhe a foto de cada quadra entre as fotos da galeria (as mesmas do carrossel da página inicial). */
export default function CourtPhotos() {
  const club = useClub().data;
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (v: { id: number; photo: string | null }) => api(`/api/admin/courts/${v.id}/photo`, { method: "PUT", json: { photo: v.photo } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["club"] }); toast("Foto da quadra atualizada"); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Falhou."),
  });
  if (!club) return null;
  return (
    <section className="card card-pad" style={{ boxShadow: "none" }}>
      <h2 className="italic-title" style={{ fontSize: 20 }}>Fotos das quadras</h2>
      <p className="muted" style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>Aparecem na página inicial (Estrutura e lista de quadras). Todas as fotos da galeria também giram no carrossel.</p>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        {club.courts.map((c) => (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {c.photo
              ? <img src={c.photo.replace("-1600.webp", "-800.webp")} alt={`Foto atual da ${c.name}`} style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 14 }} />
              : <div className="photo-ph" style={{ height: 130, borderRadius: 14 }}>Sem foto</div>}
            <label className="field">{c.name.toUpperCase()}
              <select className="select" value={c.photo ?? ""} disabled={save.isPending} onChange={(e) => save.mutate({ id: c.id, photo: e.target.value || null })}>
                <option value="">Sem foto</option>
                {club.gallery.map((g, i) => <option key={g.src} value={g.src}>Foto {i + 1} · {g.alt.split(",")[0]}</option>)}
              </select>
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
