import React, { useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import LoginPage from "./features/auth/LoginPage";
import ChannelDashboard from "./features/channels/ChannelPage";
import MonitorView from "./features/monitor/MonitorPage";
import ServerStatusIndicator from "./features/monitor/ServerStatusIndicator";
import { ComputerIcon, SettingsIcon } from "lucide-react";

type View = "dashboard" | "monitor";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const { isLoggedIn, logout, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-soft)",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "3px solid var(--border-main)",
            borderTop: "3px solid var(--primary)",
            animation: "spin 1s linear infinite",
          }}
        />
      </div>
    );
  }

  if (!isLoggedIn) return <LoginPage />;

  const NavButton: React.FC<{
    view: View;
    label: string;
    icon: React.ReactNode;
  }> = ({ view, label, icon }) => (
    <button
      onClick={() => setCurrentView(view)}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition
        ${currentView === view ? "btn-primary" : "btn-secondary hover:bg-gray-100"}`}
    >
      {icon}
      {label}
    </button>
  );

  const renderView = () => {
    if (currentView === "monitor") return <MonitorView />;
    return <ChannelDashboard />;
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="flex justify-between items-center px-8 py-4 border-b border-[var(--border-main)] bg-white">
        <div className="flex items-center gap-2 bg-[var(--bg-soft)] rounded-md p-1">
          <NavButton view="dashboard" label="Channels" icon={<SettingsIcon className="w-4 h-4" />} />
          <NavButton view="monitor" label="Monitor" icon={<ComputerIcon className="w-4 h-4" />} />
        </div>

        <div className="flex items-center gap-4">
          <ServerStatusIndicator />
          <button onClick={logout} className="btn-primary px-4 py-2 text-sm">
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 bg-[var(--bg-soft)]">{renderView()}</main>
    </div>
  );
};

export default App;
