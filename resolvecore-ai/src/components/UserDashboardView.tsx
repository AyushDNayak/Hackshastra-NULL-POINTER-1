import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Plus, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { formatDateTime, priorityStyle, statusMeta } from '../lib/formatters';
import type { ComplaintSummary } from '../types';

interface UserDashboardViewProps {
  onNewComplaint: () => void;
  onSelectComplaint: (id: number) => void;
  onOpenNotifications: () => void;
}

export function UserDashboardView({
  onNewComplaint,
  onSelectComplaint,
  onOpenNotifications,
}: UserDashboardViewProps) {
  const { token, notifications, lastWsEvent } = useAuth();
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const fetchComplaints = useCallback(async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await apiFetch<{ complaints: ComplaintSummary[] }>(
        `/api/complaints?${params.toString()}`,
        { token }
      );
      setComplaints(res.complaints || []);
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, search]);

  useEffect(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  useEffect(() => {
    if (lastWsEvent?.event === 'complaint:updated') {
      fetchComplaints();
    }
  }, [lastWsEvent, fetchComplaints]);

  const total = complaints.length;
  const pending = complaints.filter((c) =>
    ['SUBMITTED', 'AI_TRIAGED', 'ASSIGNED', 'AWAITING_INFO', 'REOPENED'].includes(c.status)
  ).length;
  const inProgress = complaints.filter(
    (c) => c.status === 'ACCEPTED' || c.status === 'IN_PROGRESS' || c.status === 'ESCALATED'
  ).length;
  const resolved = complaints.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A]">Complainant Workspace</h1>
          <p className="text-sm text-slate-600 mt-1">
            Submit issues by text or voice, monitor AI routing progress, and communicate directly with assigned departments.
          </p>
        </div>
        <button
          type="button"
          onClick={onNewComplaint}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Submit New Complaint
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Submitted', value: total, tone: 'text-[#0F172A]' },
          { label: 'Pending Triage', value: pending, tone: 'text-[#D97706]' },
          { label: 'In Progress', value: inProgress, tone: 'text-[#2563EB]' },
          { label: 'Resolved & Closed', value: resolved, tone: 'text-[#16A34A]' },
        ].map((kpi) => (
          <div key={kpi.label} className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs font-medium text-slate-500">{kpi.label}</div>
            <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${kpi.tone}`}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Complaint Tracking List */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by tracking ID, title, or location..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">All Statuses</option>
              <option value="ASSIGNED">Assigned</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="AWAITING_INFO">Awaiting Info</option>
              <option value="ESCALATED">Escalated</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : complaints.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-medium text-[#0F172A]">No complaints submitted yet</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Submit your first complaint using text or voice detection to experience instant AI classification and department routing.
              </p>
              <button
                type="button"
                onClick={onNewComplaint}
                className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
              >
                Submit First Complaint
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {complaints.map((c) => {
                const pStyle = priorityStyle(c.priority);
                const sMeta = statusMeta(c.status);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectComplaint(c.id)}
                    className="w-full text-left p-5 hover:bg-slate-50 transition-colors flex flex-wrap items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-[#0F172A]">{c.trackingCode}</span>
                        <span aria-hidden="true">·</span>
                        <span>{c.categoryName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{c.departmentName || 'Pending Routing'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{formatDateTime(c.createdAt)}</span>
                      </div>
                      <div className="text-sm font-semibold text-[#0F172A] truncate">{c.title}</div>
                      {c.aiSummary && (
                        <p className="text-xs text-slate-600 line-clamp-2">{c.aiSummary}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs font-semibold ${sMeta.text}`}>{sMeta.label}</span>
                      <span className={`text-[11px] font-medium ${pStyle.text}`}>{pStyle.label} Priority</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Notifications */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <Bell className="w-4 h-4 text-[#2563EB]" />
              Recent Activity
            </div>
            <button
              type="button"
              onClick={onOpenNotifications}
              className="text-xs font-semibold text-[#2563EB] hover:underline"
            >
              View All
            </button>
          </div>
          {notifications.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 text-center">No notifications yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {notifications.slice(0, 5).map((n) => (
                <div
                  key={n.id}
                  onClick={() => n.complaintId && onSelectComplaint(n.complaintId)}
                  className={`p-4 text-xs space-y-1 cursor-pointer hover:bg-slate-50 ${
                    !n.isRead ? 'bg-[#EFF6FF]/40' : ''
                  }`}
                >
                  <div className="font-semibold text-[#0F172A]">{n.title}</div>
                  <div className="text-slate-600 line-clamp-2">{n.body}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums">{formatDateTime(n.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
