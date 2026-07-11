'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore, type AppView } from '@/store/app-store';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { LoginPage } from '@/components/auth/login-page';
import { SignupPage } from '@/components/auth/signup-page';
import { ProfilePage } from '@/components/auth/profile-page';
import { DashboardPage } from '@/components/dashboard/dashboard-page';
import { EmployeePage } from '@/components/employees/employee-page';
import { AttendancePage } from '@/components/attendance/attendance-page';
import { AttendanceCopyPage } from '@/components/attendance-copy/attendance-copy-page';
import { NotificationPage } from '@/components/notifications/notification-page';
import { AdminPage } from '@/components/admins/admin-page';
import { SitesPage } from '@/components/sites/sites-page';
import { LeaveRequestPage } from '@/components/leave-requests/leave-request-page';
import { CancellationRequestPage } from '@/components/cancellation-requests/cancellation-request-page';
import { UniformRegistryPage } from '@/components/uniform-registry/uniform-registry-page';
import { AccountsPage } from '@/components/accounts/accounts-page';
import { ConsolidatedSalaryPage } from '@/components/consolidated-salary/consolidated-salary-page';
import { AdvancePage } from '@/components/advance/advance-page';
import { EmployeeHoursLedger } from '@/components/employees/employee-hours-ledger';
import { EmployeeHoursDirectory } from '@/components/employees/employee-hours-directory';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePresenceHeartbeat } from '@/hooks/use-presence-heartbeat';

type AppState = 'checking' | 'needs_setup' | 'unauthenticated' | 'authenticated';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <div className="flex flex-col items-center gap-6 w-full max-w-sm px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-blue-500 shadow-lg shadow-blue-500/25 flex items-center justify-center">
            <span className="text-2xl font-bold text-white">A</span>
          </div>
          <Skeleton className="h-7 w-24 bg-slate-800" />
          <Skeleton className="h-4 w-48 bg-slate-800" />
        </div>
        <div className="w-full bg-slate-800/50 rounded-xl border border-slate-700/50 p-6 space-y-4">
          <Skeleton className="h-5 w-32 mx-auto bg-slate-700" />
          <Skeleton className="h-4 w-48 mx-auto bg-slate-700" />
          <div className="space-y-3 pt-2">
            <Skeleton className="h-4 w-20 bg-slate-700" />
            <Skeleton className="h-11 w-full rounded-md bg-slate-700" />
            <Skeleton className="h-4 w-20 bg-slate-700" />
            <Skeleton className="h-11 w-full rounded-md bg-slate-700" />
          </div>
          <Skeleton className="h-11 w-full rounded-md bg-slate-700" />
        </div>
      </div>
    </div>
  );
}

// Menus always visible to all authenticated users (including admin)
const ALWAYS_VISIBLE_VIEWS: AppView[] = ['dashboard', 'uniform_registry', 'profile'];

// Views that only super_admin can access by default (admin needs explicit permission)
const RESTRICTED_VIEWS: AppView[] = ['employees', 'sites', 'attendance', 'attendance_copy', 'accounts', 'advance', 'consolidated_salary', 'employee_hours_ledger', 'leave_requests', 'cancellation_requests', 'notifications', 'admins'];

function MainLayout() {
  const { currentView, setCurrentView, selectedEmployeeId, setSelectedEmployeeId } = useAppStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const [adminPermissions, setAdminPermissions] = useState<string[]>([]);

  // Send a presence heartbeat every 30s while the app is open so the Admin
  // Management page can show an "online" green dot for this user.
  usePresenceHeartbeat();

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

  // Map sub-views to their parent permission slug
  const VIEW_PERMISSION_MAP: Record<string, string> = {
    employee_hours_ledger: 'employees', // Uses employees permission
    advance: 'accounts', // Advance is a sub-feature of Accounts
    attendance_copy: 'attendance', // Attendance Copy is a sub-feature of Attendance
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
      case 'leave_requests':
        return <LeaveRequestPage />;
      case 'cancellation_requests':
        return <CancellationRequestPage />;
      case 'notifications':
        return <NotificationPage />;
      case 'admins':
        return <AdminPage />;
      case 'employee_hours_ledger':
        return selectedEmployeeId ? (
          <EmployeeHoursLedger
            employeeId={selectedEmployeeId}
            onBack={() => {
              setSelectedEmployeeId(null);
            }}
          />
        ) : <EmployeeHoursDirectory />;
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
        <main className="flex-1 p-4 md:p-6 overflow-auto">{renderView()}</main>
      </div>
    </div>
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
