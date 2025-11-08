import React, { useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import LoginPage from "./page/LoginPage";
import ChannelDashboard from "./page/ChannelDashboard";
import MonitorView from "./page/MonitorView";
import ServerStatusIndicator from "./page/ServerStatusIndicator";

type View = "dashboard" | "monitor";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const { isLoggedIn, logout } = useAuth();

  // Jika belum login, tampilkan halaman login
  if (!isLoggedIn) return <LoginPage />;

  // Fungsi render tampilan utama
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

  // Komponen tombol navigasi
  const NavLink: React.FC<{ view: View; label: string }> = ({ view, label }) => (
    <button
      onClick={() => setCurrentView(view)}
      className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${currentView === view ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-slate-700 hover:text-white"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200 font-sans">
      {/* SIDEBAR */}
      <aside className="w-64 flex flex-col bg-slate-800/50 border-r border-slate-700 p-4">
        {/* Header */}
        <div className="text-2xl font-bold text-white mb-8 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z"></path>
            <path d="m13 7-4 4 4 4 1-1-3-3 3-3z"></path>
          </svg>
          <span>MiniMirth</span>
        </div>

        {/* Navigasi */}
        <nav className="flex flex-col space-y-2">
          <NavLink view="dashboard" label="Dashboard" />
          <NavLink view="monitor" label="Monitor" />
        </nav>

        {/* Footer (selalu di bawah) */}
        <div className="mt-auto pt-6 border-t border-slate-700">
          <ServerStatusIndicator />
          <button onClick={logout} className="mt-4 w-full bg-red-600 text-white py-2 rounded-md hover:bg-red-700 transition-colors">
            Logout
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-y-auto p-6">{renderView()}</main>
    </div>
  );
};

export default App;
