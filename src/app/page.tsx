'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore, type AppView } from '@/store/app-store';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { LoginPage } from '@/components/auth/login-page';
import { SignupPage } from '@/components/auth/signup-page';
import { ProfilePage } from '@/components/auth/profile-page';
import { DashboardPage } from '@/components/dashboard/dashboard-page';
import { EmployeePage } from '@/components/employees/employee-page';
import { EmployeeDetailPage } from '@/components/employees/employee-detail-page';
import { CampPage } from '@/components/camps/camp-page';
import { CampDetailPage } from '@/components/camps/camp-detail-page';
import { AttendancePage } from '@/components/attendance/attendance-page';
import { AttendanceCopyPage } from '@/components/attendance-copy/attendance-copy-page';
import { AllLogsPage } from '@/components/all-logs/all-logs-page';
import { NotificationPage } from '@/components/notifications/notification-page';
import { AdminPage } from '@/components/admins/admin-page';
import { SitesPage } from '@/components/sites/sites-page';
import { LeaveRequestPage } from '@/components/leave-requests/leave-request-page';
import { CancellationRequestPage } from '@/components/cancellation-requests/cancellation-request-page';
import { UniformRegistryPage } from '@/components/uniform-registry/uniform-registry-page';
import { AccountsPage } from '@/components/accounts/accounts-page';
import { ConsolidatedSalaryPage } from '@/components/consolidated-salary/consolidated-salary-page';
import { AdvancePage } from '@/components/advance/advance-page';
import { DocumentsPage } from '@/components/documents/documents-page';
import { NocViewPage } from '@/components/documents/noc-view-page';
import { EmployeeHoursLedger } from '@/components/employees/employee-hours-ledger';
import { EmployeeHoursDirectory } from '@/components/employees/employee-hours-directory';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePresenceHeartbeat } from '@/hooks/use-presence-heartbeat';
import { PageTransition } from '@/components/motion';
import { CommandPalette } from '@/components/layout/command-palette';

type AppState = 'checking' | 'needs_setup' | 'unauthenticated' | 'authenticated';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <div className="flex flex-col items-center gap-6 w-full max-w-sm px-4">
        <div className="flex flex-col items-center gap-3">
          <motion.img
            src="/logo_asm.png"
            alt="ASM"
            className="h-14 w-14 rounded-2xl object-contain shadow-lg"
            initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          />
          <motion.div
            className="flex flex-col items-center gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <span className="asm-gradient-text text-2xl font-bold">ASM</span>
            <span className="text-xs text-slate-500">Loading your workspace…</span>
          </motion.div>
        </div>
        <motion.div
          className="w-full bg-slate-800/50 rounded-xl border border-slate-700/50 p-6 space-y-4"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
        >
          <div className="h-5 w-32 mx-auto rounded asm-shimmer" />
          <div className="h-4 w-48 mx-auto rounded asm-shimmer" />
          <div className="space-y-3 pt-2">
            <div className="h-4 w-20 rounded asm-shimmer" />
            <div className="h-11 w-full rounded-md asm-shimmer" />
            <div className="h-4 w-20 rounded asm-shimmer" />
            <div className="h-11 w-full rounded-md asm-shimmer" />
          </div>
          <div className="h-11 w-full rounded-md asm-shimmer" />
        </motion.div>
      </div>
    </div>
  );
}

// Menus always visible to all authenticated users (including admin)
const ALWAYS_VISIBLE_VIEWS: AppView[] = ['dashboard', 'profile'];

// Views that only super_admin can access by default (admin needs explicit permission)
const RESTRICTED_VIEWS: AppView[] = ['employees', 'employee_add', 'employee_batch_add', 'sites', 'attendance', 'attendance_copy', 'accounts', 'advance', 'consolidated_salary', 'employee_hours_ledger', 'employee_detail', 'camps', 'camp_detail', 'uniform_registry', 'leave_requests', 'cancellation_requests', 'notifications', 'admins', 'all_logs', 'documents', 'noc_view'];

function MainLayout() {
  const { currentView, setCurrentView, selectedEmployeeId, setSelectedEmployeeId, selectedNocId, setSelectedNocId, sidebarOpen, setSidebarOpen } = useAppStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const [adminPermissions, setAdminPermissions] = useState<string[]>([]);

  // Send a presence heartbeat every 30s while the app is open so the Admin
  // Management page can show an "online" green dot for this user.
  usePresenceHeartbeat();

  // On mobile the sidebar is a Sheet — never auto-open it on load.
  const mobileInitialized = useRef(false);
  React.useEffect(() => {
    if (isMobile && !mobileInitialized.current) {
      mobileInitialized.current = true;
      if (sidebarOpen) setSidebarOpen(false);
    }
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  // Fetch admin menu permissions dynamically from the Permission system
  React.useEffect(() => {
    if (!user || user.role === 'super_admin') {
      setAdminPermissions([]);
      return;
    }
    const fetchPermissions = async () => {
      try {
        const res = await fetch(`/api/permissions?adminId=${user.id}`);
        const data = await res.json();
        if (data.success) {
          const perms = data.data.permissions || [];
          // Get all slugs where granted is true, plus always visible ones
          const grantedSlugs = [
            ...ALWAYS_VISIBLE_VIEWS,
            ...perms
              .filter((p: { slug: string; granted?: boolean }) => p.granted === true)
              .map((p: { slug: string }) => p.slug),
          ];
          setAdminPermissions([...new Set(grantedSlugs)]);
        }
      } catch {
        // Fallback: try legacy menu-permissions API
        try {
          const res = await fetch(`/api/menu-permissions?userId=${user.id}`);
          const data = await res.json();
          if (data.success) {
            setAdminPermissions(data.data.allowedMenus || []);
          }
        } catch {
          // silent
        }
      }
    };
    fetchPermissions();
    // Refresh every 15 seconds for snappier permission updates
    const interval = setInterval(fetchPermissions, 15000);
    return () => clearInterval(interval);
  }, [user]);

  // Map sub-views to their permission slug.
  // Most views use their own slug directly (e.g. 'accounts' → 'accounts').
  // These mappings are for views whose ID differs from their permission slug.
  const VIEW_PERMISSION_MAP: Record<string, string> = {
    employee_hours_ledger: 'employee_hours', // View ID ≠ permission slug
    advance: 'accounts', // Advance is a sub-feature of Accounts
    all_logs: 'admins', // All Logs is a sub-feature of Admin Management
    noc_view: 'documents', // NOC viewer rides on the Documents permission
  };

  // Dynamic view permission check
  const isViewAllowed = useCallback((view: AppView): boolean => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    // Admin: always visible views are allowed
    if (ALWAYS_VISIBLE_VIEWS.includes(view)) return true;
    // Admin: restricted views need explicit permission
    if (RESTRICTED_VIEWS.includes(view)) {
      const permSlug = VIEW_PERMISSION_MAP[view] || view;
      return adminPermissions.includes(permSlug);
    }
    return false;
  }, [user, adminPermissions]);

  // Redirect admin users away from restricted views
  React.useEffect(() => {
    if (user && !isViewAllowed(currentView)) {
      setCurrentView('dashboard');
    }
  }, [user, currentView, setCurrentView, isViewAllowed]);

  const renderView = () => {
    // Block admin users from accessing restricted views
    if (user && !isViewAllowed(currentView)) {
      return <DashboardPage />;
    }

    switch (currentView) {
      case 'dashboard':
        return <DashboardPage />;
      case 'employees':
      case 'employee_add':
      case 'employee_batch_add':
        return <EmployeePage />;
      case 'sites':
        return <SitesPage />;
      case 'attendance':
        return <AttendancePage />;
      case 'attendance_copy':
        return <AttendanceCopyPage />;
      case 'accounts':
        return <AccountsPage />;
      case 'advance':
        return <AdvancePage />;
      case 'consolidated_salary':
        return <ConsolidatedSalaryPage />;
      case 'uniform_registry':
        return <UniformRegistryPage />;
      case 'documents':
        return <DocumentsPage />;
      case 'noc_view':
        return selectedNocId ? (
          <NocViewPage
            nocId={selectedNocId}
            onBack={() => {
              setSelectedNocId(null);
              setCurrentView('documents');
            }}
            onEditDraft={(id) => {
              setSelectedNocId(id);
              setCurrentView('documents');
            }}
          />
        ) : (
          <DocumentsPage />
        );
      case 'leave_requests':
        return <LeaveRequestPage />;
      case 'cancellation_requests':
        return <CancellationRequestPage />;
      case 'notifications':
        return <NotificationPage />;
      case 'admins':
        return <AdminPage />;
      case 'all_logs':
        return <AllLogsPage />;
      case 'employee_hours_ledger':
        return selectedEmployeeId ? (
          <EmployeeHoursLedger
            employeeId={selectedEmployeeId}
            onBack={() => {
              setSelectedEmployeeId(null);
            }}
          />
        ) : <EmployeeHoursDirectory />;
      case 'employee_detail':
        return selectedEmployeeId ? <EmployeeDetailPage /> : <EmployeePage />;
      case 'camps':
        return <CampPage />;
      case 'camp_detail':
        return selectedEmployeeId ? <CampDetailPage /> : <CampPage />;
      case 'profile':
        return <ProfilePage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-900">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AppHeader />
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <AnimatePresence mode="wait" initial={false}>
            <PageTransition key={currentView}>
              {renderView()}
            </PageTransition>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette />
      <ScrollToTopButton />
    </div>
  );
}

// Floating button that appears after scrolling down — smooth-scrolls back up.
function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.6, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 12 }}
          whileHover={{ y: -3, scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 400, damping: 26 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll to top"
          className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-400"
        >
          <ArrowUp className="h-5 w-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function getDerivedAppState(user: ReturnType<typeof useAuthStore.getState>['user'], hasUsers: boolean | null): AppState {
  if (user) return 'authenticated';
  if (hasUsers === false) return 'needs_setup';
  if (hasUsers === true) return 'unauthenticated';
  return 'checking';
}

export default function Home() {
  const { user, setUser, setLoading } = useAuthStore();
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const hasChecked = useRef(false);

  const resolveState = useCallback((): AppState => {
    return getDerivedAppState(user, hasUsers);
  }, [user, hasUsers]);

  const appState = resolveState();

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();

        if (cancelled) return;

        const usersExist = data.data?.hasUsers ?? false;
        setHasUsers(usersExist);

        // Check localStorage for stored user
        const stored = typeof window !== 'undefined' ? localStorage.getItem('asm_user') : null;
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            setUser(parsed);
          } catch {
            localStorage.removeItem('asm_user');
          }
        }

        setLoading(false);
      } catch {
        if (cancelled) return;
        setHasUsers(true);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (appState === 'checking') {
    return <LoadingScreen />;
  }

  if (appState === 'needs_setup') {
    return <SignupPage />;
  }

  if (appState === 'unauthenticated') {
    return <LoginPage />;
  }

  return <MainLayout />;
}
