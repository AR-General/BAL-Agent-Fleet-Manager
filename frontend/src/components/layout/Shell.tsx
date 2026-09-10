import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ImageLightboxProvider } from "../common/ImageLightbox";
import { useAuth } from "../../stores/auth";
import { usePortalMode } from "../../stores/portalMode";
import { useViewMode } from "../../stores/viewMode";

const operatorNav = [
  { to: "/", label: "Dashboard" },
  { to: "/instances", label: "Instances" },
  { to: "/teams", label: "Teams" },
  { to: "/contacts", label: "Contacts" },
  { to: "/phone-numbers", label: "Phone numbers" },
  { to: "/devices", label: "Devices" },
  { to: "/agents", label: "Agents" },
  { to: "/vrms", label: "VRMs" },
  { to: "/chat", label: "Chat" },
  { to: "/stats", label: "Stats" },
  { to: "/settings", label: "Settings" },
];

const tenantNav = [
  { to: "/", label: "Dashboard" },
  { to: "/contacts", label: "Directory" },
  { to: "/chat", label: "Chat" },
];

export function Shell() {
  const { user, logout } = useAuth();
  const { mode, setMode } = useViewMode();
  const { mode: portalMode, setMode: setPortalMode } = usePortalMode();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = mode === "operator" ? operatorNav : tenantNav;
  const isChatRoute = location.pathname === "/chat" || location.pathname.startsWith("/chat/");

  return (
    <ImageLightboxProvider>
    <div className={isChatRoute ? "layout layout-chat" : "layout"}>
      <aside className="sidebar">
        <div className="sidebar-brand">AI Agents Controller</div>
        <nav className="sidebar-nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-footer-label muted">Portal preview</div>
          <div className="toggle toggle-block">
            <button
              type="button"
              className={portalMode === "internal" ? "active" : ""}
              onClick={() => setPortalMode("internal")}
              title="Show public and internal profile images"
            >
              Internal
            </button>
            <button
              type="button"
              className={portalMode === "demo" ? "active" : ""}
              onClick={() => setPortalMode("demo")}
              title="Demo portal — public profile images only"
            >
              Demo
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="header">
          <div className="toggle">
            <button
              type="button"
              className={mode === "operator" ? "active" : ""}
              onClick={() => setMode("operator")}
            >
              Operator
            </button>
            <button
              type="button"
              className={mode === "tenant" ? "active" : ""}
              onClick={() => setMode("tenant")}
            >
              Tenant
            </button>
          </div>
          <span className="muted">{user?.email}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void logout().then(() => navigate("/login"));
            }}
          >
            Log out
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
    </ImageLightboxProvider>
  );
}
