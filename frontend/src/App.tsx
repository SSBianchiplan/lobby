import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Spinner } from "./components/Layout";
import { Tracker } from "./components/Tracker";
import Home from "./pages/Home";
import Agenda from "./pages/Agenda";
import Confirm from "./pages/Confirm";
import Reservations from "./pages/Reservations";
import ReservationDetail from "./pages/ReservationDetail";
import Invite from "./pages/Invite";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import Admin from "./pages/admin/Admin";
import Terms from "./pages/Terms";
import CoachArea from "./pages/CoachArea";
import CheckinLink, { CoachLink, StudentLink } from "./pages/CheckinLink";
import CheckinKiosk from "./pages/admin/CheckinKiosk";

export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to={`/entrar?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (user.must_change_password && loc.pathname !== "/perfil") return <Navigate to="/perfil?trocar-senha=1" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <div className="app">
      <ScrollTop />
      <Tracker />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/agenda/confirmar" element={<Confirm />} />
        <Route path="/reservas" element={<RequireAuth><Reservations /></RequireAuth>} />
        <Route path="/reservas/:code" element={<RequireAuth><ReservationDetail /></RequireAuth>} />
        <Route path="/convite/:token" element={<Invite />} />
        <Route path="/entrar" element={<Login />} />
        <Route path="/cadastro" element={<Login register />} />
        <Route path="/termos" element={<Terms />} />
        <Route path="/checkin/:code" element={<CheckinLink />} />
        <Route path="/aluno/:token" element={<StudentLink />} />
        <Route path="/professor" element={<RequireAuth><CoachArea /></RequireAuth>} />
        <Route path="/professor/:token" element={<CoachLink />} />
        <Route path="/recepcao" element={<RequireAuth admin><CheckinKiosk /></RequireAuth>} />
        <Route path="/perfil" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/admin/*" element={<RequireAuth admin><Admin /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
