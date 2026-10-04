import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Users, History, UserRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { api, API_BASE_URL } from '../../services/api';
import {
  PageHeading,
  EmptyState,
  RefreshButton,
  formatTime,
} from '../../components/ui/OperationalUI';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
interface Account {
  id: number;
  username: string;
  name: string;
  role: string;
}
interface AuditRow {
  id: number;
  action: string;
  resource_type: string;
  resource_id: number;
  created_at: string;
  user_id: number | null;
}
const roles = ['ADMIN', 'DEVELOPER', 'OPERATOR', 'VIEWER'];
export default function SettingsPage() {
  const { role, name, can } = useAuth();
  const [tab, setTab] = useState('account'),
    [page, setPage] = useState(1),
    [users, setUsers] = useState<Account[]>([]),
    [audits, setAudits] = useState<AuditRow[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'VIEWER' });
  const [roleChange, setRoleChange] = useState<{ account: Account; role: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'users') {
        const { data } = await api.get('/users', { params: { page } });
        setUsers(data.data);
      } else if (tab === 'audit') {
        const { data } = await api.get('/audit', { params: { page } });
        setAudits(data.data);
      } else {
        await api.get(API_BASE_URL + '/ready', { baseURL: '' });
        setReady(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load settings');
      setReady(false);
    } finally {
      setLoading(false);
    }
  }, [tab, page]);
  useEffect(() => {
    void load();
  }, [load]);
  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/users', form);
      setCreating(false);
      setForm({ username: '', name: '', password: '', role: 'VIEWER' });
      setNotice('User created successfully.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create user');
    } finally {
      setBusy(false);
    }
  }
  async function saveRole() {
    if (!roleChange) return;
    setBusy(true);
    try {
      await api.put(`/users/${roleChange.account.id}/role`, { role: roleChange.role });
      setRoleChange(null);
      setNotice('User role updated.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to change role');
    } finally {
      setBusy(false);
    }
  }
  const rows = tab === 'users' ? users : audits;
  return (
    <div className="page-stack">
      <PageHeading
        title="Settings"
        description="Manage workspace access and review operational activity."
        actions={<RefreshButton onClick={() => void load()} loading={loading} />}
      />
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {[
          { id: 'account', label: 'Account & connection', icon: UserRound },
          ...(can('user:manage')
            ? [
                { id: 'users', label: 'Users', icon: Users },
                { id: 'audit', label: 'Audit log', icon: History },
              ]
            : []),
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setPage(1);
              setNotice('');
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {tab === 'account' ? (
        <div className="settings-grid">
          <section className="card-bw settings-panel">
            <ShieldCheck size={25} className="accent" />
            <h2>Your account</h2>
            <p>Permissions follow your assigned workspace role.</p>
            <dl className="definition-list">
              <div>
                <dt>Name</dt>
                <dd>{name || 'User'}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>
                  <span className="role-badge">{role}</span>
                </dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>
                  {role === 'VIEWER'
                    ? 'Read-only channel and message metadata'
                    : role === 'OPERATOR'
                      ? 'Operate channels and review deliveries'
                      : role === 'DEVELOPER'
                        ? 'Configure channels and processing scripts'
                        : 'Workspace administration and all operational tools'}
                </dd>
              </div>
            </dl>
          </section>
          <section className="card-bw settings-panel">
            <h2>Workspace connection</h2>
            <p>The current backend and database connection.</p>
            <dl className="definition-list">
              <div>
                <dt>API</dt>
                <dd>{API_BASE_URL || window.location.origin}</dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{loading ? 'Checking…' : ready ? 'Connected' : 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd>HTTP / HL7 / MLLP</dd>
              </div>
            </dl>
            <p className="muted">
              Source credentials are managed in each channel. Database credentials stay on the
              server.
            </p>
          </section>
        </div>
      ) : (
        <section className="card-bw">
          <div className="panel-heading">
            <div>
              <h2>{tab === 'users' ? 'Workspace users' : 'Audit activity'}</h2>
              <p>
                {tab === 'users'
                  ? 'Use the least access each person needs.'
                  : 'Configuration, access and payload review events.'}
              </p>
            </div>
            {tab === 'users' && (
              <Button
                onClick={() => {
                  setCreating(true);
                  setError('');
                }}
              >
                Add user
              </Button>
            )}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {(tab === 'users'
                    ? ['User', 'Username', 'Role', 'Action']
                    : ['Time', 'Action', 'Resource', 'User ID']
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4}>Loading…</td>
                  </tr>
                ) : tab === 'users' ? (
                  users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                      </td>
                      <td>{u.username}</td>
                      <td>
                        <span className="role-badge">{u.role}</span>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => {
                            setRoleChange({ account: u, role: u.role });
                            setError('');
                          }}
                        >
                          Change role
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  audits.map((a) => (
                    <tr key={a.id}>
                      <td>{formatTime(a.created_at)}</td>
                      <td>{a.action.toLowerCase().replaceAll('_', ' ')}</td>
                      <td>
                        {a.resource_type} {a.resource_id ? '#' + a.resource_id : ''}
                      </td>
                      <td>{a.user_id ?? 'System'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && !rows.length && (
            <EmptyState title="No results" description="There are no entries on this page." />
          )}
          <div className="pagination">
            <Button
              variant="secondary"
              disabled={loading || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="secondary"
              disabled={loading || rows.length < 50}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </section>
      )}
      <Modal
        isOpen={creating}
        onClose={() => {
          if (!busy) {
            setCreating(false);
            setError('');
          }
        }}
        title="Add workspace user"
      >
        <form className="form-body" onSubmit={saveUser}>
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          {(['name', 'username', 'password'] as const).map((key) => (
            <label key={key} className="field">
              <span>
                {key === 'name' ? 'Full name' : key === 'username' ? 'Username' : 'Password'}
              </span>
              <input
                type={key === 'password' ? 'password' : 'text'}
                value={form[key]}
                autoComplete={key === 'password' ? 'new-password' : 'off'}
                required
                minLength={key === 'password' ? 12 : undefined}
                maxLength={key === 'password' ? 72 : undefined}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </label>
          ))}
          <p className="muted">Password must have at least 12 characters.</p>
          <label className="field">
            <span>Role</span>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button disabled={busy}>{busy ? 'Creating…' : 'Create user'}</Button>
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={!!roleChange}
        onClose={() => {
          if (!busy) setRoleChange(null);
        }}
        title="Change user role"
      >
        <div className="form-body">
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          <p>
            Update access for <strong>{roleChange?.account.name}</strong> (
            {roleChange?.account.username}).
          </p>
          <label className="field">
            <span>New role</span>
            <select
              value={roleChange?.role || 'VIEWER'}
              onChange={(e) => setRoleChange((r) => (r ? { ...r, role: e.target.value } : null))}
            >
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <p className="muted">This change is audited. The last administrator cannot be removed.</p>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setRoleChange(null)} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void saveRole()}>
              Confirm role change
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
