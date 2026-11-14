import React, { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, Play, Search, Shield, Sliders, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { formatDateTime, priorityStyle, statusMeta } from '../lib/formatters';
import type { ComplaintCategory, ComplaintSummary, Department, SlaConfig } from '../types';

interface AdminDashboardViewProps {
  onSelectComplaint: (id: number) => void;
}

const CHART_COLORS = ['#0F172A', '#2563EB', '#0284C7', '#16A34A', '#D97706', '#DC2626', '#64748B'];

export function AdminDashboardView({ onSelectComplaint }: AdminDashboardViewProps) {
  const { token, lastWsEvent } = useAuth();
  const [tab, setTab] = useState<'overview' | 'complaints' | 'config' | 'users' | 'audit'>('overview');

  const [analytics, setAnalytics] = useState<any>(null);
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<ComplaintCategory[]>([]);
  const [slaConfigs, setSlaConfigs] = useState<SlaConfig[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [auditData, setAuditData] = useState<{ auditLogs: any[]; aiDecisions: any[] }>({
    auditLogs: [],
    aiDecisions: [],
  });

  const [search, setSearch] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<ComplaintSummary | null>(null);
  const [overrideForm, setOverrideForm] = useState({
    categoryName: '',
    priority: 'HIGH',
    departmentId: '',
    overrideReason: '',
  });

  // New Category / Department forms
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');
  const [newDeptResp, setNewDeptResp] = useState('');

  const loadAll = useCallback(async () => {
    if (!token) return;
    const [anaRes, compRes, metaRes, usersRes, auditRes] = await Promise.all([
      apiFetch('/api/admin/analytics', { token }),
      apiFetch<{ complaints: ComplaintSummary[] }>('/api/complaints', { token }),
      apiFetch<{ categories: ComplaintCategory[]; departments: Department[]; slaConfigurations: SlaConfig[] }>(
        '/api/meta'
      ),
      apiFetch<{ users: any[] }>('/api/admin/users', { token }),
      apiFetch<{ auditLogs: any[]; aiDecisions: any[] }>('/api/admin/audit-logs', { token }),
    ]);

    setAnalytics(anaRes);
    setComplaints(compRes.complaints || []);
    setCategories(metaRes.categories || []);
    setDepartments(metaRes.departments || []);
    setSlaConfigs(metaRes.slaConfigurations || []);
    setUsersList(usersRes.users || []);
    setAuditData(auditRes);
  }, [token]);

  useEffect(() => {
    loadAll().catch(() => {});
  }, [loadAll]);

  useEffect(() => {
    if (lastWsEvent?.event === 'complaint:updated') {
      loadAll().catch(() => {});
    }
  }, [lastWsEvent, loadAll]);

  const handleRunSlaWatchdog = async () => {
    const res = await apiFetch<{ escalatedCount: number }>('/api/admin/run-sla-check', {
      method: 'POST',
      token,
    });
    setStatusMsg(`SLA Watchdog completed: ${res.escalatedCount} overdue complaint(s) escalated.`);
    await loadAll();
  };

  const handleExportCsv = async () => {
    if (!token) return;
    const res = await fetch('/api/admin/export-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resolvecore-executive-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOverrideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideTarget) return;
    await apiFetch(`/api/admin/complaints/${overrideTarget.id}/override`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        categoryName: overrideForm.categoryName,
        priority: overrideForm.priority,
        departmentId: overrideForm.departmentId ? Number(overrideForm.departmentId) : undefined,
        overrideReason: overrideForm.overrideReason,
      }),
    });
    setStatusMsg(`Override applied to ${overrideTarget.trackingCode}.`);
    setOverrideTarget(null);
    await loadAll();
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/categories', {
      method: 'POST',
      token,
      body: JSON.stringify({ name: newCatName, description: newCatDesc }),
    });
    setNewCatName('');
    setNewCatDesc('');
    setStatusMsg('New complaint category added.');
    await loadAll();
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/departments', {
      method: 'POST',
      token,
      body: JSON.stringify({ name: newDeptName, code: newDeptCode, responsibilities: newDeptResp }),
    });
    setNewDeptName('');
    setNewDeptCode('');
    setNewDeptResp('');
    setStatusMsg('New department created.');
    await loadAll();
  };

  const handleUpdateSla = async (sla: SlaConfig) => {
    await apiFetch(`/api/admin/sla/${sla.priority}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({
        responseHours: sla.responseHours,
        resolutionHours: sla.resolutionHours,
        autoEscalate: sla.autoEscalate,
      }),
    });
    setStatusMsg(`Updated SLA thresholds for ${sla.priority}.`);
    await loadAll();
  };

  const handleUserRoleChange = async (userId: number, role: string, departmentId: number | null) => {
    await apiFetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ role, departmentId }),
    });
    setStatusMsg('Updated user permissions.');
    await loadAll();
  };

  const kpis = analytics?.kpis || {
    total: 0,
    resolved: 0,
    pending: 0,
    critical: 0,
    avgResolutionHours: 0,
    slaComplianceRate: 100,
    avgRating: 0,
  };

  const filteredComplaints = complaints.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return `${c.trackingCode} ${c.title} ${c.categoryName} ${c.departmentName || ''}`
      .toLowerCase()
      .includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A]">
            Enterprise Administration & AI Governance
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Monitor live SLA compliance, inspect AI routing decisions, manage departments, and export governance reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRunSlaWatchdog}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-semibold"
          >
            <Play className="w-3.5 h-3.5 text-[#60A5FA]" />
            Run SLA Watchdog
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A]"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] text-xs font-medium text-[#16A34A] flex items-center justify-between">
          <span>{statusMsg}</span>
          <button type="button" onClick={() => setStatusMsg(null)} className="text-slate-500 hover:text-slate-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {[
          { id: 'overview', label: 'Analytics & Charts' },
          { id: 'complaints', label: `All Complaints (${complaints.length})` },
          { id: 'config', label: 'Categories, Depts & SLA' },
          { id: 'users', label: 'Users & Roles' },
          { id: 'audit', label: 'AI Decisions & Audit Logs' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as any)}
            className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === item.id ? 'bg-white text-[#0F172A] shadow-xs' : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* TAB 1: ANALYTICS OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Total Complaints', value: kpis.total, tone: 'text-[#0F172A]' },
              { label: 'Resolved', value: kpis.resolved, tone: 'text-[#16A34A]' },
              { label: 'Pending Action', value: kpis.pending, tone: 'text-[#D97706]' },
              { label: 'Critical Priority', value: kpis.critical, tone: 'text-[#DC2626]' },
              { label: 'Avg Resolution', value: `${kpis.avgResolutionHours}h`, tone: 'text-[#2563EB]' },
              { label: 'SLA Compliance', value: `${kpis.slaComplianceRate}%`, tone: 'text-[#0F172A]' },
            ].map((k) => (
              <div key={k.label} className="p-4 rounded-xl border border-slate-200 bg-white">
                <div className="text-xs font-medium text-slate-500">{k.label}</div>
                <div className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${k.tone}`}>
                  {k.value}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Category Distribution */}
            <div className="lg:col-span-7 p-6 rounded-xl border border-slate-200 bg-white">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Complaint Category Distribution</h3>
              {analytics?.categoryDistribution?.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.categoryDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-xs text-slate-500">
                  Submit complaints to populate live category telemetry.
                </div>
              )}
            </div>

            {/* Priority Distribution */}
            <div className="lg:col-span-5 p-6 rounded-xl border border-slate-200 bg-white">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Priority Distribution</h3>
              {kpis.total > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics.priorityDistribution.filter((p: any) => p.count > 0)}
                        dataKey="count"
                        nameKey="priority"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                      >
                        {analytics.priorityDistribution.map((_: any, i: number) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-xs text-slate-500">
                  No priority distribution recorded yet.
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Resolution Trends */}
            <div className="lg:col-span-6 p-6 rounded-xl border border-slate-200 bg-white">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Intake vs Resolution Trends</h3>
              {analytics?.trends?.length > 0 ? (
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics.trends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="submitted" stroke="#2563EB" fill="#2563EB" fillOpacity={0.15} />
                      <Area type="monotone" dataKey="resolved" stroke="#16A34A" fill="#16A34A" fillOpacity={0.15} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-60 flex items-center justify-center text-xs text-slate-500">
                  Daily trends populate automatically as complaints are logged and resolved.
                </div>
              )}
            </div>

            {/* Department Performance Table */}
            <div className="lg:col-span-6 p-6 rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Department Performance</h3>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2">Department</th>
                    <th className="py-2 text-right">Assigned</th>
                    <th className="py-2 text-right">Resolved</th>
                    <th className="py-2 text-right">Escalated</th>
                    <th className="py-2 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(analytics?.departmentPerformance || []).map((d: any) => (
                    <tr key={d.id}>
                      <td className="py-2.5 font-medium text-[#0F172A]">{d.name}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{d.total}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-[#16A34A]">{d.resolved}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-[#DC2626]">{d.escalated}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{d.resolutionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ALL COMPLAINTS + AI OVERRIDE */}
      {tab === 'complaints' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search complaints by tracking ID, title, category, or department..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                  <th className="py-3 px-4">Tracking ID</th>
                  <th className="py-3 px-4">Title & Category</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredComplaints.map((c) => {
                  const pStyle = priorityStyle(c.priority);
                  const sMeta = statusMeta(c.status);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-semibold text-[#0F172A]">{c.trackingCode}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#0F172A]">{c.title}</div>
                        <div className="text-slate-500">{c.categoryName} · {c.complainantName}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">{c.departmentName || 'Unassigned'}</td>
                      <td className={`py-3 px-4 font-semibold ${pStyle.text}`}>{pStyle.label}</td>
                      <td className={`py-3 px-4 font-semibold ${sMeta.text}`}>{sMeta.label}</td>
                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectComplaint(c.id)}
                          className="text-xs font-semibold text-[#2563EB] hover:underline"
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideTarget(c);
                            setOverrideForm({
                              categoryName: c.categoryName,
                              priority: c.priority,
                              departmentId: c.departmentId ? String(c.departmentId) : '',
                              overrideReason: '',
                            });
                          }}
                          className="text-xs font-semibold text-[#0F172A] hover:underline"
                        >
                          Override AI
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CATEGORIES, DEPARTMENTS & SLA */}
      {tab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Categories */}
          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <Sliders className="w-4 h-4 text-[#2563EB]" />
              Complaint Categories ({categories.length})
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
              {categories.map((c) => (
                <div key={c.id} className="py-2">
                  <span className="font-semibold text-[#0F172A]">{c.name}</span>
                  <span className="text-slate-500"> — {c.description}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleCreateCategory} className="pt-3 border-t border-slate-200 space-y-2">
              <div className="text-xs font-semibold text-[#0F172A]">Add Custom Category</div>
              <input
                type="text"
                required
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category name (e.g., Environmental Compliance)"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                value={newCatDesc}
                onChange={(e) => setNewCatDesc(e.target.value)}
                placeholder="Scope description for Classification Agent"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold">
                Add Category
              </button>
            </form>
          </div>

          {/* Departments */}
          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="text-sm font-semibold text-[#0F172A]">Departments ({departments.length})</div>
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
              {departments.map((d) => (
                <div key={d.id} className="py-2">
                  <span className="font-mono font-semibold text-[#2563EB] mr-2">[{d.code}]</span>
                  <span className="font-semibold text-[#0F172A]">{d.name}</span>
                  <div className="text-slate-500 mt-0.5">{d.responsibilities}</div>
                </div>
              ))}
            </div>
            <form onSubmit={handleCreateDepartment} className="pt-3 border-t border-slate-200 space-y-2">
              <div className="text-xs font-semibold text-[#0F172A]">Create Department</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="Department Name"
                  className="col-span-2 px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  required
                  value={newDeptCode}
                  onChange={(e) => setNewDeptCode(e.target.value)}
                  placeholder="Code (e.g. ENV)"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <input
                type="text"
                required
                value={newDeptResp}
                onChange={(e) => setNewDeptResp(e.target.value)}
                placeholder="Responsibilities for AI Assignment Agent..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#0F172A] text-white text-xs font-semibold">
                Create Department
              </button>
            </form>
          </div>

          {/* SLA Rules */}
          <div className="lg:col-span-2 p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="text-sm font-semibold text-[#0F172A]">Priority SLA Deadlines & Auto-Escalation</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {slaConfigs.map((sla) => (
                <div key={sla.priority} className="p-4 rounded-lg border border-slate-200 bg-[#F8FAFC] space-y-3 text-xs">
                  <div className="font-semibold text-[#0F172A]">{sla.priority}</div>
                  <div>
                    <label className="text-slate-500 block mb-1">Response Target (hrs)</label>
                    <input
                      type="number"
                      min={1}
                      value={sla.responseHours}
                      onChange={(e) =>
                        setSlaConfigs((prev) =>
                          prev.map((s) =>
                            s.priority === sla.priority ? { ...s, responseHours: Number(e.target.value) } : s
                          )
                        )
                      }
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-500 block mb-1">Resolution Target (hrs)</label>
                    <input
                      type="number"
                      min={1}
                      value={sla.resolutionHours}
                      onChange={(e) =>
                        setSlaConfigs((prev) =>
                          prev.map((s) =>
                            s.priority === sla.priority ? { ...s, resolutionHours: Number(e.target.value) } : s
                          )
                        )
                      }
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white font-mono"
                    />
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={sla.autoEscalate}
                      onChange={(e) =>
                        setSlaConfigs((prev) =>
                          prev.map((s) =>
                            s.priority === sla.priority ? { ...s, autoEscalate: e.target.checked } : s
                          )
                        )
                      }
                    />
                    <span>Auto-Escalate</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleUpdateSla(sla)}
                    className="w-full py-1.5 rounded bg-[#2563EB] text-white font-semibold"
                  >
                    Save SLA
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: USERS & ROLES */}
      {tab === 'users' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Department</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {usersList.map((u) => (
                <tr key={u.id}>
                  <td className="py-3 px-4 font-semibold text-[#0F172A]">{u.name}</td>
                  <td className="py-3 px-4 text-slate-600">{u.email}</td>
                  <td className="py-3 px-4">
                    <select
                      value={u.role}
                      onChange={(e) => handleUserRoleChange(u.id, e.target.value, u.departmentId)}
                      className="px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                    >
                      <option value="USER">USER (Complainant)</option>
                      <option value="STAFF">STAFF (Department)</option>
                      <option value="ADMIN">ADMIN (Operations)</option>
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    {u.role === 'STAFF' ? (
                      <select
                        value={u.departmentId || ''}
                        onChange={(e) =>
                          handleUserRoleChange(u.id, u.role, e.target.value ? Number(e.target.value) : null)
                        }
                        className="px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                      >
                        <option value="">Select Department</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-400">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 5: AI DECISIONS & AUDIT LOGS */}
      {tab === 'audit' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <Shield className="w-4 h-4 text-[#2563EB]" />
              AI Agent Decision Monitor
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 text-xs">
              {auditData.aiDecisions.map((a) => (
                <div key={a.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#0F172A]">
                      {a.agentName} · {a.trackingCode || `#${a.complaintId}`}
                    </span>
                    <span className="text-slate-500 tabular-nums">{formatDateTime(a.createdAt)}</span>
                  </div>
                  <div className="text-slate-600">
                    Model: {a.modelUsed} {a.isDemoMode ? '(Demo Mode)' : ''}
                    {a.recommendedCategory ? ` · Cat: ${a.recommendedCategory}` : ''}
                    {a.recommendedPriority ? ` · Priority: ${a.recommendedPriority}` : ''}
                    {a.recommendedDepartment ? ` · Dept: ${a.recommendedDepartment}` : ''}
                  </div>
                  {a.overriddenByAdmin && (
                    <div className="text-[#D97706] font-medium">
                      Overridden by Admin: {a.overrideReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 text-sm font-semibold text-[#0F172A]">
              Immutable System Audit Trail
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 text-xs">
              {auditData.auditLogs.map((log) => (
                <div key={log.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-[#0F172A]">{log.action}</span>
                    <span className="text-slate-500 tabular-nums">{formatDateTime(log.createdAt)}</span>
                  </div>
                  <div className="text-slate-600">
                    Actor: {log.actorEmail} ({log.actorRole}) · Entity: {log.entityType} #{log.entityId}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* AI Override Modal */}
      {overrideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/60 p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#0F172A]">
                Override AI Routing · {overrideTarget.trackingCode}
              </h3>
              <button type="button" onClick={() => setOverrideTarget(null)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleOverrideSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Category</label>
                <select
                  value={overrideForm.categoryName}
                  onChange={(e) => setOverrideForm({ ...overrideForm, categoryName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Priority</label>
                <select
                  value={overrideForm.priority}
                  onChange={(e) => setOverrideForm({ ...overrideForm, priority: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Department</label>
                <select
                  value={overrideForm.departmentId}
                  onChange={(e) => setOverrideForm({ ...overrideForm, departmentId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Audit Reason *</label>
                <input
                  type="text"
                  required
                  minLength={4}
                  value={overrideForm.overrideReason}
                  onChange={(e) => setOverrideForm({ ...overrideForm, overrideReason: e.target.value })}
                  placeholder="Why is AI decision being overridden?"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#2563EB] text-white font-semibold"
                >
                  Apply Override
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
