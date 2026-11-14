import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type WorkspacePage =
  | 'dashboard'
  | 'submit'
  | 'department'
  | 'admin'
  | 'insights'
  | 'notifications'
  | 'tracking';

interface WorkspaceShellProps {
  activePage: WorkspacePage;
  onNavigate: (page: WorkspacePage) => void;
  onGoHome: () => void;
  breadcrumb: string;
  children: React.ReactNode;
}

export function WorkspaceShell({
  activePage,
  onNavigate,
  onGoHome,
  breadcrumb,
  children,
}: WorkspaceShellProps) {
  const { user, unreadCount, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: Array<{ id: WorkspacePage; label: string; icon: React.ReactNode; badge?: number }> = [
    ...(user?.role === 'USER'
      ? [
          {
            id: 'dashboard' as WorkspacePage,
            label: 'My Complaints',
            icon: <LayoutDashboard className="w-4 h-4" />,
          },
        ]
      : []),
    {
      id: 'submit',
      label: 'Submit Complaint',
      icon: <PlusCircle className="w-4 h-4" />,
    },
    ...(user?.role === 'STAFF' || user?.role === 'ADMIN'
      ? [
          {
            id: 'department' as WorkspacePage,
            label: 'Department Queue',
            icon: <Briefcase className="w-4 h-4" />,
          },
        ]
      : []),
    ...(user?.role === 'ADMIN'
      ? [
          {
            id: 'admin' as WorkspacePage,
            label: 'Admin Console',
            icon: <BarChart3 className="w-4 h-4" />,
          },
        ]
      : []),
    ...(user?.role === 'STAFF' || user?.role === 'ADMIN'
      ? [
          {
            id: 'insights' as WorkspacePage,
            label: 'AI Insights',
            icon: <TrendingUp className="w-4 h-4" />,
          },
        ]
      : []),
    {
      id: 'notifications',
      label: 'Notifications',
      icon: <Bell className="w-4 h-4" />,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
  ];

  const SidebarContent = (
    <div className="flex flex-col h-full bg-[#0F172A] text-white">
      <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
        <button
          type="button"
          onClick={onGoHome}
          className="font-display text-base font-bold tracking-tight text-white hover:text-[#93C5FD] transition-colors"
        >
          ResolveCore AI
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1 text-slate-400 hover:text-white"
          aria-label="Close navigation menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                setMobileOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-[#2563EB] text-white'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge !== undefined && (
                <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-white/15 text-white tabular-nums">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 space-y-3">
        <div className="text-xs">
          <div className="font-semibold text-white truncate">{user?.name}</div>
          <div className="text-slate-400 truncate">{user?.email}</div>
          <div className="text-[11px] text-[#93C5FD] mt-0.5">
            Role: {user?.role} {user?.departmentName ? `· ${user.departmentName}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onGoHome}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white"
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-[#DC2626] text-xs font-medium text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-[#0F172A]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="w-64 h-full">{SidebarContent}</div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 text-slate-700"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs font-medium text-slate-500 truncate">
              ResolveCore AI / <span className="text-[#0F172A] font-semibold">{breadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#0F172A] whitespace-nowrap"
            >
              <Bell className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Alerts</span>
              {unreadCount > 0 && (
                <span className="font-mono text-[11px] font-bold text-[#2563EB] tabular-nums">
                  ({unreadCount})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('submit')}
              className="px-3.5 py-1.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold whitespace-nowrap"
            >
              New Complaint
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
