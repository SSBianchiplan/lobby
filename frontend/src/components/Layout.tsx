import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Notification } from "../api";
import { useAuth } from "../auth";
import { useClub } from "../hooks";
import { initials } from "../format";
import { Bell, CalendarIcon, CheckIcon, HomeIcon, UserIcon } from "./Icons";

export function Logo({ height = 52, alt = "Padel Lobby — Rio Grande, RS" }: { height?: number; alt?: string }) {
  return <img src="/logo.png" alt={alt} className="logo" style={{ height, width: "auto", display: "block" }} />;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["notifications"], enabled: !!user, refetchInterval: 30_000,
    queryFn: () => api<{ unread: number; items: Notification[] }>("/api/notifications"),
  });
  const read = useMutation({ mutationFn: () => api("/api/notifications/read", { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!user) return null;
  const unread = q.data?.unread ?? 0;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="icon-btn" aria-label={`Notificações${unread ? ` (${unread} novas)` : ""}`} aria-expanded={open}
        onClick={() => { setOpen(!open); if (!open && unread) read.mutate(); }}>
        <Bell />
        {unread > 0 && <span className="dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Notificações">
          {!q.data?.items.length && <p className="empty">Nada por aqui ainda.</p>}
          {q.data?.items.map((n) => (
            <Link key={n.id} to={n.link || "#"} className={`notif${n.read ? "" : " unread"}`} onClick={() => setOpen(false)}>
              <p style={{ fontSize: 14, fontWeight: 800 }}>{n.title}</p>
              {n.body && <p style={{ marginTop: 2, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>{n.body}</p>}
              <p style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: "var(--off-ink)" }}>{new Date(n.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteHeader({ cta }: { cta?: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const onHome = pathname === "/";
  return (
    <header className="site-header">
      <div className="container">
        <Link to="/" aria-label="Início"><Logo /></Link>
        <nav aria-label="Principal" className="site-nav">
          <NavLink to="/agenda" aria-current={pathname.startsWith("/agenda") ? "page" : undefined}>Agenda</NavLink>
          {user && <NavLink to="/reservas">Minhas reservas</NavLink>}
          {user?.role === "admin" ? <NavLink to="/admin">Administração</NavLink> : (
            <>
              <a href={onHome ? "#estrutura" : "/#estrutura"}>Estrutura</a>
              <a href={onHome ? "#promocoes" : "/#promocoes"}>Promoções</a>
              <a href={onHome ? "#contato" : "/#contato"}>Contato</a>
            </>
          )}
        </nav>
        <NotificationBell />
        {user ? (
          <Link to="/perfil" className="user-chip">
            <span className="avatar avatar-red" style={{ width: 40, height: 40 }}>{initials(user.name)}</span>
            {user.name.split(" ")[0]}
          </Link>
        ) : (
          <Link to="/entrar" className="link-strong">Entrar</Link>
        )}
        {cta ?? <Link to="/agenda" className="btn btn-primary">{user ? "Nova reserva" : "Reservar quadra"}</Link>}
      </div>
    </header>
  );
}

export function MobileHeader({ title }: { title?: ReactNode }) {
  return (
    <header className="m-header">
      {title ? <h1>{title}</h1> : <Link to="/" aria-label="Início"><Logo height={48} /></Link>}
      {title ? <Logo height={34} alt="Padel Lobby" /> : <NotificationBell />}
    </header>
  );
}

export function BottomNav() {
  const { pathname } = useLocation();
  const item = (to: string, label: string, icon: ReactNode, match: boolean) => (
    <Link to={to} aria-current={match ? "page" : undefined}>{icon}{label}</Link>
  );
  return (
    <nav aria-label="Principal" className="bottom-nav">
      {item("/", "Início", <HomeIcon />, pathname === "/")}
      {item("/agenda", "Agenda", <CalendarIcon />, pathname.startsWith("/agenda"))}
      {item("/reservas", "Reservas", <CheckIcon />, pathname.startsWith("/reservas"))}
      {item("/perfil", "Perfil", <UserIcon />, pathname.startsWith("/perfil") || pathname.startsWith("/entrar") || pathname.startsWith("/admin"))}
    </nav>
  );
}

export function SiteFooter() {
  const club = useClub().data;
  const wa = club?.whatsapp ? `https://wa.me/${club.whatsapp.replace(/\D/g, "")}` : undefined;
  return (
    <footer className="site-footer web-only hide-mobile" id="contato">
      <div className="container">
        <p style={{ fontWeight: 900, fontStyle: "italic", fontSize: 18 }}>PADEL <span style={{ color: "var(--ball)" }}>LOBBY</span></p>
        {club && <a href={`mailto:${club.email}`}>{club.email}</a>}
        {wa ? <a href={wa}>WhatsApp</a> : <span style={{ fontWeight: 600 }}>WhatsApp [TELEFONE]</span>}
        <span style={{ marginLeft: "auto", color: "#BDB6B6", fontWeight: 500 }}>© {new Date().getFullYear()} Padel Lobby · Rio Grande, RS</span>
      </div>
    </footer>
  );
}

export const Spinner = () => <div className="spinner" role="status" aria-label="Carregando" />;
