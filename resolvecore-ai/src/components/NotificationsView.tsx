import React, { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/formatters';

interface NotificationsViewProps {
  onSelectComplaint: (id: number) => void;
}

export function NotificationsView({ onSelectComplaint }: NotificationsViewProps) {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useAuth();
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | 'ESCALATION' | 'ASSIGNED' | 'MESSAGE'>('ALL');

  const filtered = notifications.filter((n) => {
    if (filter === 'UNREAD') return !n.isRead;
    if (filter === 'ESCALATION') return n.type === 'ESCALATION';
    if (filter === 'ASSIGNED') return n.type === 'ASSIGNED';
    if (filter === 'MESSAGE') return n.type === 'MESSAGE';
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A]">Notification Center</h1>
          <p className="text-sm text-slate-600 mt-1">
            Real-time intake confirmations, department assignments, messages, SLA alerts, and resolution updates.
          </p>
        </div>

        <button
          type="button"
          onClick={markAllNotificationsRead}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A]"
        >
          <CheckCheck className="w-3.5 h-3.5 text-[#2563EB]" />
          Mark All Read
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {[
          { id: 'ALL', label: 'All' },
          { id: 'UNREAD', label: 'Unread' },
          { id: 'ASSIGNED', label: 'Assignments' },
          { id: 'MESSAGE', label: 'Messages' },
          { id: 'ESCALATION', label: 'Escalations' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id as any)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              filter === t.id ? 'bg-white text-[#0F172A] shadow-xs' : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Bell className="w-6 h-6 text-slate-400 mx-auto" />
            <p className="text-sm font-medium text-[#0F172A]">No notifications in this view</p>
            <p className="text-xs text-slate-500">Live updates arrive automatically as complaints progress.</p>
          </div>
        ) : (
          filtered.map((n) => (
            <div
              key={n.id}
              onClick={async () => {
                if (!n.isRead) await markNotificationRead(n.id);
                if (n.complaintId) onSelectComplaint(n.complaintId);
              }}
              className={`p-5 flex items-start justify-between gap-4 cursor-pointer hover:bg-slate-50 transition-colors ${
                !n.isRead ? 'bg-[#EFF6FF]/40' : ''
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`font-semibold ${
                      n.type === 'ESCALATION'
                        ? 'text-[#DC2626]'
                        : n.type === 'RESOLVED'
                        ? 'text-[#16A34A]'
                        : 'text-[#2563EB]'
                    }`}
                  >
                    {n.type}
                  </span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="text-slate-500 tabular-nums">{formatDateTime(n.createdAt)}</span>
                  {!n.isRead && (
                    <>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="font-semibold text-[#2563EB]">Unread</span>
                    </>
                  )}
                </div>
                <div className="text-sm font-semibold text-[#0F172A]">{n.title}</div>
                <div className="text-xs text-slate-600 leading-relaxed">{n.body}</div>
              </div>

              {n.complaintId && (
                <span className="text-xs font-semibold text-[#2563EB] whitespace-nowrap shrink-0">
                  Open Case
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
