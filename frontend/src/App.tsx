import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { useAuth } from "./stores/auth";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InstancesPage } from "./pages/InstancesPage";
import { InstanceDetailPage } from "./pages/InstanceDetailPage";
import { TeamsPage } from "./pages/TeamsPage";
import { ContactsPage } from "./pages/ContactsPage";
import { ContactDetailPage } from "./pages/ContactDetailPage";
import { PhoneNumbersPage } from "./pages/PhoneNumbersPage";
import { DevicesPage } from "./pages/DevicesPage";
import { AgentsPage } from "./pages/AgentsPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { VrmModelsPage } from "./pages/VrmModelsPage";
import { VrmModelDetailPage } from "./pages/VrmModelDetailPage";
import { ChatPage } from "./pages/ChatPage";
import { StatsPage } from "./pages/StatsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { InstancesChannelsMatrixPage } from "./pages/InstancesChannelsMatrixPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, bootstrapped, restoreSession } = useAuth();

  useEffect(() => {
    if (!bootstrapped) {
      void restoreSession();
    }
  }, [bootstrapped, restoreSession]);

  if (!bootstrapped) {
    return <p className="muted" style={{ padding: "2rem" }}>Restoring session…</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="instances" element={<InstancesPage />} />
        <Route path="instances/channels" element={<InstancesChannelsMatrixPage />} />
        <Route path="instances/:slug" element={<InstanceDetailPage />} />
        <Route path="instances/:slug/channels" element={<ChannelsPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="contacts/:slug" element={<ContactDetailPage />} />
        <Route path="phone-numbers" element={<PhoneNumbersPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="vrms" element={<VrmModelsPage />} />
        <Route path="vrms/:id" element={<VrmModelDetailPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:sessionId" element={<ChatPage />} />
        <Route path="chat/:sessionId/scene" element={<ChatPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
