import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { Spinner } from "../../components/Layout";
import { useTheme } from "../../components/Theme";

const load = () => api<string>("/api/admin/manual");

export function downloadManual(html: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = "manual-do-sistema-padel-lobby.html"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Cartão na aba Usuários (só administradores chegam aqui). */
export function ManualCard() {
  const q = useQuery({ queryKey: ["admin", "manual"], queryFn: load, staleTime: 10 * 60_000 });
  return (
    <section className="card card-pad" style={{ boxShadow: "none", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <h2 className="italic-title" style={{ fontSize: 20 }}>Manual do sistema</h2>
        <p className="muted" style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Todos os módulos e funcionalidades, rotinas da recepção e regras de negócio. Exclusivo para administradores.</p>
      </div>
      <Link className="btn btn-primary btn-sm" to="/admin/manual">Abrir manual</Link>
      <button className="btn btn-outline btn-sm" disabled={!q.data} onClick={() => q.data && downloadManual(q.data)}>Baixar (.html)</button>
    </section>
  );
}

/** Manual dentro do sistema, no tema atual. */
export default function Manual() {
  const { dark } = useTheme();
  const q = useQuery({ queryKey: ["admin", "manual"], queryFn: load, staleTime: 10 * 60_000 });
  if (!q.data) return <Spinner />;
  const html = q.data.replace('<html lang="pt-BR">', `<html lang="pt-BR" data-theme="${dark ? "dark" : "light"}">`)
    .replace("<head>", '<head><base target="_blank">');
  return (
    <div className="stack gap-14">
      <div className="between" style={{ flexWrap: "wrap", gap: 10 }}>
        <Link to="/admin/usuarios" className="text-link">← Usuários</Link>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => (document.getElementById("manual-frame") as HTMLIFrameElement | null)?.contentWindow?.print()}>Imprimir</button>
          <button className="btn btn-outline btn-sm" onClick={() => downloadManual(q.data!)}>Baixar (.html)</button>
        </div>
      </div>
      <iframe id="manual-frame" title="Manual do sistema" srcDoc={html} sandbox="allow-same-origin allow-popups allow-modals"
        style={{ width: "100%", height: "calc(100dvh - 220px)", minHeight: 520, border: 0, borderRadius: 20, background: "var(--bg)" }} />
    </div>
  );
}
