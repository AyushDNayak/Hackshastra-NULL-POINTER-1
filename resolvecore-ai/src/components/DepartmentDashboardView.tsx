import React, { useCallback, useEffect, useState } from 'react';
import { Download, Search, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { formatDateTime, formatRelativeSla, priorityStyle, statusMeta } from '../lib/formatters';
import type { ComplaintSummary } from '../types';

interface DepartmentDashboardViewProps {
  onSelectComplaint: (id: number) => void;
}

const PRIORITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function DepartmentDashboardView({ onSelectComplaint }: DepartmentDashboardViewProps) {
  const { user, token, lastWsEvent } = useAuth();
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [workloads, setWorkloads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'priority' | 'newest' | 'sla'>('priority');

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [compRes, workRes] = await Promise.all([
        apiFetch<{ complaints: ComplaintSummary[] }>('/api/complaints', { token }),
        apiFetch<{ departments: any[] }>('/api/department/workload', { token }),
      ]);
      setComplaints(compRes.complaints || []);
      setWorkloads(workRes.departments || []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (lastWsEvent?.event === 'complaint:updated') {
      loadData();
    }
  }, [lastWsEvent, loadData]);

  const filtered = complaints
    .filter((c) => {
      if (priorityFilter !== 'ALL' && c.priority !== priorityFilter) return false;
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${c.trackingCode} ${c.title} ${c.location || ''} ${c.complainantName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'priority') {
        const diff = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
        if (diff !== 0) return diff;
      }
      if (sortBy === 'sla') {
        const aDue = a.slaResolutionDueAt ? new Date(a.slaResolutionDueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bDue = b.slaResolutionDueAt ? new Date(b.slaResolutionDueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aDue - bDue;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const totalAssigned = complaints.length;
  const newQueue = complaints.filter((c) => c.status === 'ASSIGNED' || c.status === 'SUBMITTED').length;
  const pendingCount = complaints.filter((c) => c.status === 'AWAITING_INFO' || c.status === 'REOPENED').length;
  const inProgress = complaints.filter((c) => c.status === 'ACCEPTED' || c.status === 'IN_PROGRESS').length;
  const resolvedCount = complaints.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED').length;
  const overdueCount = complaints.filter((c) => c.isEscalated).length;

  const handleExportCsv = async () => {
    if (!token) return;
    const res = await fetch('/api/admin/export-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'department-complaints-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A]">
            {user?.departmentName || 'Department Operations Queue'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Review assigned complaints, accept cases, consult Agent 5 SOP playbooks, and verify resolutions.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A]"
        >
          <Download className="w-3.5 h-3.5" />
          Export Queue CSV
        </button>
      </div>

      {/* 6 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Total Assigned', value: totalAssigned, tone: 'text-[#0F172A]' },
          { label: 'New Queue', value: newQueue, tone: 'text-[#2563EB]' },
          { label: 'Pending / Info', value: pendingCount, tone: 'text-[#D97706]' },
          { label: 'In Progress', value: inProgress, tone: 'text-[#0284C7]' },
          { label: 'Resolved', value: resolvedCount, tone: 'text-[#16A34A]' },
          { label: 'Overdue / Escalated', value: overdueCount, tone: 'text-[#DC2626]' },
        ].map((k) => (
          <div key={k.label} className="p-4 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs font-medium text-slate-500">{k.label}</div>
            <div className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${k.tone}`}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Priority Queue Table */}
        <div className="lg:col-span-9 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by ID, title, citizen, or zone..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">All Priorities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">All Statuses</option>
              <option value="ASSIGNED">New Assigned</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="AWAITING_INFO">Awaiting Info</option>
              <option value="ESCALATED">Escalated</option>
              <option value="RESOLVED">Resolved</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="priority">Sort: Priority Queue</option>
              <option value="sla">Sort: Nearest SLA</option>
              <option value="newest">Sort: Most Recent</option>
            </select>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No complaints match your active department queue filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                    <th className="py-3 px-4">Tracking ID</th>
                    <th className="py-3 px-4">Complaint & Category</th>
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">SLA Deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filtered.map((c) => {
                    const pStyle = priorityStyle(c.priority);
                    const sMeta = statusMeta(c.status);
                    const sla = formatRelativeSla(
                      c.slaResolutionDueAt,
                      c.status === 'RESOLVED' || c.status === 'CLOSED'
                    );
                    return (
                      <tr
                        key={c.id}
                        onClick={() => onSelectComplaint(c.id)}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono font-semibold text-[#0F172A] whitespace-nowrap">
                          {c.trackingCode}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#0F172A]">{c.title}</div>
                          <div className="text-slate-500 mt-0.5">
                            {c.categoryName} · {c.complainantName || 'Citizen'} · {formatDateTime(c.createdAt)}
                          </div>
                        </td>
                        <td className={`py-3.5 px-4 font-semibold whitespace-nowrap ${pStyle.text}`}>
                          {pStyle.label}
                        </td>
                        <td className={`py-3.5 px-4 font-semibold whitespace-nowrap ${sMeta.text}`}>
                          {sMeta.label}
                        </td>
                        <td
                          className={`py-3.5 px-4 font-medium tabular-nums whitespace-nowrap ${
                            sla.tone === 'critical'
                              ? 'text-[#DC2626]'
                              : sla.tone === 'warning'
                              ? 'text-[#D97706]'
                              : 'text-[#16A34A]'
                          }`}
                        >
                          {sla.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Staff Workload Capacity Panel */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
            <Users className="w-4 h-4 text-[#2563EB]" />
            Staff Workload
          </div>
          {workloads.flatMap((d) => d.staff || []).length === 0 ? (
            <p className="text-xs text-slate-500">No active staff capacity records.</p>
          ) : (
            <div className="space-y-4">
              {workloads.flatMap((d) =>
                (d.staff || []).map((s: any) => {
                  const pct = Math.min(100, Math.round((s.activeCount / Math.max(1, s.maxActiveLoad)) * 100));
                  return (
                    <div key={s.staffId} className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#0F172A] truncate">{s.name}</span>
                        <span className="font-mono text-slate-600 tabular-nums">
                          {s.activeCount}/{s.maxActiveLoad}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{s.title}</div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pct > 80 ? 'bg-[#DC2626]' : pct > 50 ? 'bg-[#D97706]' : 'bg-[#2563EB]'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
