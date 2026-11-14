import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LandingPage } from './components/LandingPage';
import { AuthModal } from './components/AuthModal';
import { WorkspaceShell, type WorkspacePage } from './components/WorkspaceShell';
import { UserDashboardView } from './components/UserDashboardView';
import { DepartmentDashboardView } from './components/DepartmentDashboardView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { SubmitComplaintView } from './components/SubmitComplaintView';
import { ComplaintTrackingView } from './components/ComplaintTrackingView';
import { AiInsightsView } from './components/AiInsightsView';
import { NotificationsView } from './components/NotificationsView';

function AppRouter() {
  const { user, loading } = useAuth();
  const [viewMode, setViewMode] = useState<'landing' | 'workspace'>('landing');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('login');
  const [activePage, setActivePage] = useState<WorkspacePage>('dashboard');
  const [selectedComplaintId, setSelectedComplaintId] = useState<number | null>(null);

  const defaultPageForRole = (role?: string): WorkspacePage => {
    if (role === 'ADMIN') return 'admin';
    if (role === 'STAFF') return 'department';
    return 'dashboard';
  };

  useEffect(() => {
    if (user && viewMode === 'workspace') {
      setActivePage((prev) => {
        if (prev === 'dashboard' && user.role !== 'USER') return defaultPageForRole(user.role);
        return prev;
      });
    }
  }, [user, viewMode]);

  const openAuth = (mode: 'login' | 'register') => {
    setAuthInitialMode(mode);
    setAuthModalOpen(true);
  };

  const handleEnterWorkspace = () => {
    if (!user) {
      openAuth('login');
      return;
    }
    setActivePage(defaultPageForRole(user.role));
    setViewMode('workspace');
  };

  const handleOpenComplaint = (id: number) => {
    setSelectedComplaintId(id);
    setActivePage('tracking');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] text-sm font-medium text-slate-600">
        Initializing ResolveCore AI...
      </div>
    );
  }

  if (viewMode === 'landing' || !user) {
    return (
      <>
        <LandingPage
          isAuthenticated={Boolean(user)}
          onOpenAuth={openAuth}
          onEnterWorkspace={handleEnterWorkspace}
        />
        <AuthModal
          isOpen={authModalOpen}
          initialMode={authInitialMode}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => {
            setViewMode('workspace');
          }}
        />
      </>
    );
  }

  const breadcrumbMap: Record<WorkspacePage, string> = {
    dashboard: 'My Complaints',
    submit: 'Submit Complaint',
    department: 'Department Queue',
    admin: 'Admin Governance',
    insights: 'AI Insights',
    notifications: 'Notifications',
    tracking: 'Complaint Tracking',
  };

  return (
    <WorkspaceShell
      activePage={activePage}
      breadcrumb={breadcrumbMap[activePage]}
      onNavigate={(p) => {
        if (p !== 'tracking') setSelectedComplaintId(null);
        setActivePage(p);
      }}
      onGoHome={() => setViewMode('landing')}
    >
      {activePage === 'dashboard' && (
        <UserDashboardView
          onNewComplaint={() => setActivePage('submit')}
          onSelectComplaint={handleOpenComplaint}
          onOpenNotifications={() => setActivePage('notifications')}
        />
      )}

      {activePage === 'submit' && (
        <SubmitComplaintView
          onSubmitted={(id) => handleOpenComplaint(id)}
          onCancel={() => setActivePage(defaultPageForRole(user.role))}
        />
      )}

      {activePage === 'department' && (
        <DepartmentDashboardView onSelectComplaint={handleOpenComplaint} />
      )}

      {activePage === 'admin' && <AdminDashboardView onSelectComplaint={handleOpenComplaint} />}

      {activePage === 'insights' && <AiInsightsView />}

      {activePage === 'notifications' && (
        <NotificationsView onSelectComplaint={handleOpenComplaint} />
      )}

      {activePage === 'tracking' && selectedComplaintId !== null && (
        <ComplaintTrackingView
          complaintId={selectedComplaintId}
          onBack={() => setActivePage(defaultPageForRole(user.role))}
        />
      )}
    </WorkspaceShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
