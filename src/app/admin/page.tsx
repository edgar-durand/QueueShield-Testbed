'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Users, Ban, CheckCircle, Clock, AlertTriangle,
  RefreshCw, Eye, Trash2, Activity, Plus, Ticket, Loader2, Settings,
} from 'lucide-react';

interface Session {
  id: string;
  ipAddress: string;
  userAgent: string;
  status: string;
  riskScore: number;
  riskLevel: string;
  isBanned: boolean;
  banReason: string | null;
  queuePosition: number | null;
  createdAt: string;
  lastSeenAt: string;
  botScores: Array<{ layer: string; category: string; score: number }>;
  _count: { telemetryEvents: number };
}

interface Stats {
  totalSessions: number;
  queueLength: number;
  admittedCount: number;
  bannedSessions: number;
  completedSessions: number;
}

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('qs_admin_token');
}

function setStoredToken(token: string) {
  localStorage.setItem('qs_admin_token', token);
}

function clearStoredToken() {
  localStorage.removeItem('qs_admin_token');
}

function riskColor(level: string) {
  switch (level) {
    case 'LOW': return 'text-success-600 bg-success-50';
    case 'MEDIUM': return 'text-warning-600 bg-warning-50';
    case 'HIGH': return 'text-orange-600 bg-orange-50';
    case 'CRITICAL': return 'text-danger-600 bg-danger-50';
    default: return 'text-slate-600 bg-slate-50';
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'IN_QUEUE': return 'text-brand-600 bg-brand-50';
    case 'ADMITTED': return 'text-success-600 bg-success-50';
    case 'PURCHASING': return 'text-purple-600 bg-purple-50';
    case 'COMPLETED': return 'text-success-700 bg-success-50';
    case 'BANNED': return 'text-danger-600 bg-danger-50';
    default: return 'text-slate-600 bg-slate-50';
  }
}

export default function AdminDashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ticketInfo, setTicketInfo] = useState<{ sold: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Check for existing token on mount
  useEffect(() => {
    const token = getStoredToken();
    if (token) setAuthenticated(true);
    else setLoading(false);
  }, []);

  const handleLogin = async (username: string, password: string) => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Login failed');
      }
      const { token } = await res.json();
      setStoredToken(token);
      setAuthenticated(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    clearStoredToken();
    setAuthenticated(false);
    setSessions([]);
    setStats(null);
  };

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sessions', {
        headers: authHeaders(),
      });
      if (res.status === 401) {
        clearStoredToken();
        setAuthenticated(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
        setStats(data.stats);
      }
    } catch {
      // Silent fail
    }

    // Fetch ticket info in parallel
    try {
      const eventRes = await fetch('/api/admin/event', { headers: authHeaders() });
      if (eventRes.ok) {
        const { event } = await eventRes.json();
        setTicketInfo({ sold: event.soldTickets, total: event.totalTickets });
      }
    } catch { /* silent */ }

    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    if (!authenticated) return;
    fetchData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData, autoRefresh, authenticated]);

  const handleAction = async (sessionId: string, action: string) => {
    await fetch('/api/admin/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ sessionId, action, reason: `Admin ${action}` }),
    });
    fetchData();
  };

  const handlePurge = async () => {
    if (!confirm('Purge ALL sessions, bot scores, telemetry, and bans? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/admin/sessions', {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Purged: ${data.purged.sessions} sessions, ${data.purged.botScores} bot scores, ${data.purged.bans} bans`);
        fetchData();
      }
    } catch {
      alert('Purge failed');
    }
  };

  if (!authenticated) {
    return <AdminLogin onLogin={handleLogin} error={loginError} loading={loginLoading} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-brand-600" />
            <div>
              <h1 className="text-2xl font-bold text-slate-900">QueueShield Admin</h1>
              <p className="text-sm text-slate-500">Real-time monitoring dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                autoRefresh
                  ? 'bg-success-50 text-success-700 border border-success-200'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}
            >
              <Activity className="w-4 h-4 inline mr-1" />
              {autoRefresh ? 'Live' : 'Paused'}
            </button>
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4 inline mr-1" />
              Refresh
            </button>
            <button
              onClick={handlePurge}
              className="px-4 py-2 bg-danger-600 text-white rounded-lg text-sm font-medium hover:bg-danger-700 transition-colors"
            >
              <Trash2 className="w-4 h-4 inline mr-1" />
              Purge All
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors border border-slate-200"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-7 gap-4 mb-8">
            <StatCard icon={Users} label="Total Sessions" value={stats.totalSessions} color="brand" />
            <StatCard icon={Clock} label="In Queue" value={stats.queueLength} color="blue" />
            <StatCard icon={CheckCircle} label="Admitted" value={stats.admittedCount} color="green" />
            <StatCard icon={Ban} label="Banned" value={stats.bannedSessions} color="red" />
            <StatCard icon={CheckCircle} label="Completed" value={stats.completedSessions} color="emerald" />
            <StatCard icon={Ticket} label="Tickets Sold" value={ticketInfo?.sold ?? 0} color="purple" />
            <StatCard
              icon={Ticket}
              label="Available"
              value={ticketInfo ? ticketInfo.total - ticketInfo.sold : 0}
              color={ticketInfo && (ticketInfo.total - ticketInfo.sold) <= 10 ? 'red' : 'slate'}
            />
          </div>
        )}

        {/* Queue & Event Controls */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <BulkAddUsers authHeaders={authHeaders} onDone={fetchData} />
          <TicketConfig authHeaders={authHeaders} />
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Sessions Table */}
          <div className="col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Sessions ({sessions.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">ID</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Risk</th>
                    <th className="px-4 py-3 text-left font-medium">IP</th>
                    <th className="px-4 py-3 text-left font-medium">Pos</th>
                    <th className="px-4 py-3 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sessions.map((s) => (
                    <tr
                      key={s.id}
                      className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                        selectedSession?.id === s.id ? 'bg-brand-50' : ''
                      }`}
                      onClick={() => setSelectedSession(s)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {s.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(s.status)}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${riskColor(s.riskLevel)}`}>
                          {s.riskScore.toFixed(0)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{s.ipAddress}</td>
                      <td className="px-4 py-3 text-xs">{s.queuePosition ?? '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedSession(s); }}
                            className="p-1 text-slate-400 hover:text-brand-600"
                            title="Inspect"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {!s.isBanned && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(s.id, 'ban'); }}
                              className="p-1 text-slate-400 hover:text-danger-600"
                              title="Ban"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAction(s.id, 'remove'); }}
                            className="p-1 text-slate-400 hover:text-danger-600"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                        No sessions yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Session Detail Panel */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-4">Session Detail</h2>
            {selectedSession ? (
              <div className="space-y-4 text-sm">
                <div>
                  <span className="text-slate-500">ID:</span>
                  <span className="ml-2 font-mono text-xs">{selectedSession.id}</span>
                </div>
                <div>
                  <span className="text-slate-500">Status:</span>
                  <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${statusColor(selectedSession.status)}`}>
                    {selectedSession.status}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Risk Score:</span>
                  <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${riskColor(selectedSession.riskLevel)}`}>
                    {selectedSession.riskScore.toFixed(1)} ({selectedSession.riskLevel})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">IP:</span>
                  <span className="ml-2">{selectedSession.ipAddress}</span>
                </div>
                <div>
                  <span className="text-slate-500">User Agent:</span>
                  <p className="mt-1 text-xs text-slate-600 break-all bg-slate-50 rounded p-2">
                    {selectedSession.userAgent}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Queue Position:</span>
                  <span className="ml-2">{selectedSession.queuePosition ?? 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Telemetry Events:</span>
                  <span className="ml-2">{selectedSession._count.telemetryEvents}</span>
                </div>
                <div>
                  <span className="text-slate-500">Created:</span>
                  <span className="ml-2 text-xs">{new Date(selectedSession.createdAt).toLocaleString()}</span>
                </div>

                {/* Bot Scores */}
                {selectedSession.botScores.length > 0 && (
                  <div>
                    <span className="text-slate-500 block mb-2">Bot Detection Scores:</span>
                    <div className="space-y-1">
                      {selectedSession.botScores.map((bs, i) => (
                        <div key={i} className="flex justify-between text-xs bg-slate-50 rounded p-2">
                          <span className="text-slate-600">{bs.layer}/{bs.category}</span>
                          <span className={bs.score > 50 ? 'text-danger-600 font-semibold' : 'text-slate-600'}>
                            {bs.score.toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="pt-4 border-t border-slate-100 flex gap-2">
                  {!selectedSession.isBanned ? (
                    <button
                      onClick={() => handleAction(selectedSession.id, 'ban')}
                      className="px-3 py-2 bg-danger-50 text-danger-700 rounded-lg text-xs font-medium hover:bg-danger-100 transition-colors"
                    >
                      <Ban className="w-3 h-3 inline mr-1" /> Ban Session
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAction(selectedSession.id, 'unban')}
                      className="px-3 py-2 bg-success-50 text-success-700 rounded-lg text-xs font-medium hover:bg-success-100 transition-colors"
                    >
                      Unban
                    </button>
                  )}
                  <button
                    onClick={() => handleAction(selectedSession.id, 'remove')}
                    className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors"
                  >
                    <Trash2 className="w-3 h-3 inline mr-1" /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-sm">Select a session to view details</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function AdminLogin({
  onLogin,
  error,
  loading,
}: {
  onLogin: (username: string, password: string) => void;
  error: string | null;
  loading: boolean;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <Shield className="w-12 h-12 text-brand-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-900">Admin Login</h1>
          <p className="text-sm text-slate-500">QueueShield Testbed</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onLogin(username, password);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            {error && (
              <p className="text-danger-600 text-sm text-center">{error}</p>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}

function BulkAddUsers({
  authHeaders,
  onDone,
}: {
  authHeaders: () => Record<string, string>;
  onDone: () => void;
}) {
  const [count, setCount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleAdd = async () => {
    const num = parseInt(count, 10);
    if (!num || num < 1) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ count: num }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(`Added ${data.created.toLocaleString()} users (${data.elapsed}). Queue: ${data.queueSize.toLocaleString()}`);
        onDone();
      } else {
        setResult(`Error: ${data.error}`);
      }
    } catch {
      setResult('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-50 text-brand-600">
          <Plus className="w-4 h-4" />
        </div>
        <h3 className="font-semibold text-slate-900">Add Users to Queue</h3>
      </div>
      <div className="flex gap-2">
        <input
          type="number"
          min="1"
          max="50000"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="100"
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={loading}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {loading ? 'Adding...' : 'Add'}
        </button>
      </div>
      {/* Quick presets */}
      <div className="flex gap-1.5 mt-2">
        {[100, 500, 1000, 5000, 10000].map((n) => (
          <button
            key={n}
            onClick={() => setCount(String(n))}
            className="px-2 py-1 text-xs rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            {n >= 1000 ? `${n / 1000}k` : n}
          </button>
        ))}
      </div>
      {result && (
        <p className={`mt-3 text-xs ${result.startsWith('Error') ? 'text-danger-600' : 'text-success-600'}`}>
          {result}
        </p>
      )}
    </div>
  );
}

function TicketConfig({ authHeaders }: { authHeaders: () => Record<string, string> }) {
  const [totalTickets, setTotalTickets] = useState('');
  const [soldTickets, setSoldTickets] = useState('');
  const [eventName, setEventName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Fetch current event on mount
  useEffect(() => {
    const fetchEvent = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/event', { headers: authHeaders() });
        if (res.ok) {
          const { event } = await res.json();
          setTotalTickets(String(event.totalTickets));
          setSoldTickets(String(event.soldTickets));
          setEventName(event.name);
        }
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    };
    fetchEvent();
  }, [authHeaders]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {};
      if (totalTickets) body.totalTickets = parseInt(totalTickets, 10);
      if (soldTickets) body.soldTickets = parseInt(soldTickets, 10);
      if (eventName) body.name = eventName;

      const res = await fetch('/api/admin/event', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('Event updated');
        setTotalTickets(String(data.event.totalTickets));
        setSoldTickets(String(data.event.soldTickets));
        setEventName(data.event.name);
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch {
      setMessage('Network error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex items-center justify-center min-h-[160px]">
        <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-purple-50 text-purple-600">
          <Settings className="w-4 h-4" />
        </div>
        <h3 className="font-semibold text-slate-900">Event &amp; Tickets</h3>
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Event Name</label>
          <input
            type="text"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Total Tickets</label>
            <input
              type="number"
              min="0"
              value={totalTickets}
              onChange={(e) => setTotalTickets(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Sold Tickets</label>
            <input
              type="number"
              min="0"
              value={soldTickets}
              onChange={(e) => setSoldTickets(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
            />
          </div>
        </div>
        {/* Quick ticket presets */}
        <div className="flex gap-1.5">
          <span className="text-xs text-slate-400 self-center mr-1">Presets:</span>
          {[50, 100, 500, 1000, 5000].map((n) => (
            <button
              key={n}
              onClick={() => { setTotalTickets(String(n)); setSoldTickets('0'); }}
              className="px-2 py-1 text-xs rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              {n >= 1000 ? `${n / 1000}k` : n}
            </button>
          ))}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full mt-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-xs ${message.startsWith('Error') ? 'text-danger-600' : 'text-success-600'}`}>
          {message}
        </p>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    brand: 'text-brand-600 bg-brand-50',
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    red: 'text-red-600 bg-red-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    purple: 'text-purple-600 bg-purple-50',
    slate: 'text-slate-600 bg-slate-100',
  };
  const cls = colorMap[color] || colorMap.brand;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${cls} mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
