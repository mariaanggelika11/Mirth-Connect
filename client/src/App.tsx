import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  LayoutDashboard,
  LogOut,
  Settings2,
  Workflow,
} from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import LoginPage from './features/auth/LoginPage';
import ChannelDashboard from './features/channels/ChannelPage';
import MonitorView from './features/monitor/MonitorPage';
import ServerStatusIndicator from './features/monitor/ServerStatusIndicator';
import OverviewPage from './features/overview/OverviewPage';
import SettingsPage from './features/settings/SettingsPage';
export type View = 'overview' | 'channels' | 'messages' | 'settings';
const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'channels', label: 'Channels', icon: Workflow },
  { id: 'messages', label: 'Messages', icon: ArrowLeftRight },
  { id: 'settings', label: 'Settings', icon: Settings2 },
] as const;
function readRoute() {
  const [name, query = ''] = window.location.hash.slice(1).split('?');
  return { view: navigation.some((n) => n.id === name) ? (name as View) : 'overview', query };
}
export default function App() {
  const [route, setRoute] = useState(readRoute);
  const { isLoggedIn, logout, isInitializing, role, name } = useAuth();
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate = (view: View, params: Record<string, string | number> = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    window.location.hash = view + (query ? '?' + query : '');
  };
  if (isInitializing)
    return (
      <div className="app-loading">
        <Activity size={28} />
        <p>Connecting to your workspace…</p>
      </div>
    );
  if (!isLoggedIn) return <LoginPage />;
  const params = new URLSearchParams(route.query);
  return (
    <div className="app-shell">
      <a
        href="#main-content"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Workflow size={23} />
          </span>
          <div>
            <strong>Mini Mirth</strong>
            <small>Integration workspace</small>
          </div>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={`nav-item ${route.view === id ? 'active' : ''}`}
              aria-current={route.view === id ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="workspace-badge">
            <span className="status-dot" />
            Integration engine
          </span>
          <p>One place for every connection.</p>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{navigation.find((n) => n.id === route.view)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <ServerStatusIndicator />
            <div className="account-summary">
              <span className="avatar">{(name || role).slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{name || 'User'}</strong>
                <small>{role.toLowerCase()}</small>
              </div>
            </div>
            <button onClick={logout} className="icon-btn" aria-label="Sign out" title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main id="main-content" className="workspace-content" tabIndex={-1}>
          {route.view === 'overview' && <OverviewPage onNavigate={navigate} />}
          {route.view === 'channels' && (
            <ChannelDashboard
              key={route.query}
              initialChannelId={params.get('channelId') || ''}
              onViewMessages={(id) => navigate('messages', { channelId: id })}
            />
          )}
          {route.view === 'messages' && (
            <MonitorView
              key={route.query}
              initialFilters={{
                channelId: params.get('channelId') || 'ALL',
                status: params.get('status') || '',
                statusGroup:
                  params.get('statusGroup') === 'errors'
                    ? 'errors'
                    : params.get('statusGroup') === 'pending'
                      ? 'pending'
                      : undefined,
                direction: params.get('direction') || 'IN',
                messageId: Number(params.get('messageId')) || undefined,
              }}
            />
          )}
          {route.view === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
