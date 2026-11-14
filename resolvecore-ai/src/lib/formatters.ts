export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeSla(dueIso?: string | null, isResolved?: boolean): {
  label: string;
  tone: 'nominal' | 'warning' | 'critical';
} {
  if (isResolved) return { label: 'SLA Met / Closed', tone: 'nominal' };
  if (!dueIso) return { label: 'No SLA Set', tone: 'nominal' };
  const diffMs = new Date(dueIso).getTime() - Date.now();
  const hours = Math.round(diffMs / 3600000);
  if (diffMs < 0) {
    const overdueHrs = Math.abs(hours);
    return {
      label: overdueHrs < 1 ? 'Overdue (<1h)' : `Overdue by ${overdueHrs}h`,
      tone: 'critical',
    };
  }
  if (hours <= 4) {
    return { label: `${Math.max(1, hours)}h remaining`, tone: 'warning' };
  }
  return { label: `${hours}h remaining`, tone: 'nominal' };
}

export function priorityStyle(priority: string): { text: string; bg: string; label: string } {
  switch (priority) {
    case 'CRITICAL':
      return { text: 'text-[#DC2626]', bg: 'bg-[#FEF2F2] border-[#FECACA]', label: 'Critical' };
    case 'HIGH':
      return { text: 'text-[#D97706]', bg: 'bg-[#FFFBEB] border-[#FDE68A]', label: 'High' };
    case 'MEDIUM':
      return { text: 'text-[#2563EB]', bg: 'bg-[#EFF6FF] border-[#BFDBFE]', label: 'Medium' };
    default:
      return { text: 'text-[#475569]', bg: 'bg-[#F1F5F9] border-[#E2E8F0]', label: 'Low' };
  }
}

export function statusMeta(status: string): { text: string; label: string } {
  switch (status) {
    case 'SUBMITTED':
      return { text: 'text-[#475569]', label: 'Submitted' };
    case 'AI_TRIAGED':
      return { text: 'text-[#2563EB]', label: 'AI Triaged' };
    case 'ASSIGNED':
      return { text: 'text-[#1D4ED8]', label: 'Assigned' };
    case 'ACCEPTED':
      return { text: 'text-[#0284C7]', label: 'Accepted' };
    case 'IN_PROGRESS':
      return { text: 'text-[#D97706]', label: 'In Progress' };
    case 'AWAITING_INFO':
      return { text: 'text-[#D97706]', label: 'Awaiting Info' };
    case 'ESCALATED':
      return { text: 'text-[#DC2626]', label: 'Escalated' };
    case 'REOPENED':
      return { text: 'text-[#DC2626]', label: 'Reopened' };
    case 'RESOLVED':
      return { text: 'text-[#16A34A]', label: 'Resolved' };
    case 'CLOSED':
      return { text: 'text-[#0F172A]', label: 'Closed' };
    default:
      return { text: 'text-[#475569]', label: status };
  }
}
