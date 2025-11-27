import React, { useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import LoginPage from "./page/LoginPage";
import ChannelDashboard from "./page/ChannelDashboard";
import MonitorView from "./page/MonitorView";
import ServerStatusIndicator from "./page/ServerStatusIndicator";
import { ComputerIcon, SettingsIcon } from "lucide-react"; // gunakan lucide-react

type View = "dashboard" | "monitor";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const { isLoggedIn, logout } = useAuth();

  if (!isLoggedIn) return <LoginPage />;

  // Tombol navigasi (Channels / Monitor)
  const NavButton: React.FC<{
    view: View;
    label: string;
    icon: React.ReactNode;
  }> = ({ view, label, icon }) => (
    <button
      onClick={() => setCurrentView(view)}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 ${currentView === view ? "bg-indigo-600 text-white shadow-sm" : "text-slate-300 hover:bg-slate-700 hover:text-white"}`}
    >
      {icon}
      {label}
    </button>
  );

  // Render tampilan utama
  const renderView = () => {
    switch (currentView) {
      case "dashboard":
        return <ChannelDashboard />;
      case "monitor":
        return <MonitorView />;
      default:
        return <ChannelDashboard />;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-200 font-sans">
      {/* HEADER */}
      <header className="flex justify-between items-center px-8 py-4 border-b border-slate-700 bg-slate-800/70 backdrop-blur-md">
        {/* Tabs kiri */}
        <div className="flex items-center gap-3 bg-slate-800 rounded-md p-1">
          <NavButton view="dashboard" label="Channels" icon={<SettingsIcon className="w-4 h-4" />} />
          <NavButton view="monitor" label="Monitor" icon={<ComputerIcon className="w-4 h-4" />} />
        </div>

        {/* Status + Logout kanan */}
        <div className="flex items-center gap-4">
          <ServerStatusIndicator />
          <button onClick={logout} className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-1.5 rounded-md transition">
            Logout
          </button>
        </div>
      </header>

      {/* KONTEN */}
      <main className="flex-1 overflow-y-auto p-8">{renderView()}</main>
    </div>
  );
};

export default App;
