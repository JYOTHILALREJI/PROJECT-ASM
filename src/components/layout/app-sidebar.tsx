'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  Calendar,
  Bell,
  Shield,
  Crown,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Building2,
  FileText,
  Ban,
  Shirt,
  DollarSign,
  Calculator,
  Clock,
  Link2,
  History,
  Tent,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuthStore, type UserRole } from '@/store/auth-store';
import { useAppStore, type AppView } from '@/store/app-store';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { StaggerContainer, StaggerItem, PulseDot } from '@/components/motion';

interface NavItem {
  id: AppView;
  label: string;
  icon: React.ElementType;
  permissionSlug: string; // Maps to Permission.slug in the database
  roles?: UserRole[]; // If specified, only these roles can see it by default. Admins need explicit permission.
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permissionSlug: 'dashboard' },
  { id: 'employees', label: 'Employees', icon: Users, permissionSlug: 'employees', roles: ['super_admin'] },
  { id: 'employee_hours_ledger', label: 'Employee Hours', icon: Clock, permissionSlug: 'employee_hours', roles: ['super_admin'] },
  { id: 'sites', label: 'Sites', icon: Building2, permissionSlug: 'sites', roles: ['super_admin'] },
  { id: 'camps', label: 'Camps', icon: Tent, permissionSlug: 'camps', roles: ['super_admin'] },
  { id: 'attendance', label: 'Attendance', icon: Calendar, permissionSlug: 'attendance', roles: ['super_admin'] },
  { id: 'attendance_copy', label: 'Attendance Copy', icon: Link2, permissionSlug: 'attendance_copy', roles: ['super_admin'] },
  { id: 'accounts', label: 'Accounts', icon: DollarSign, permissionSlug: 'accounts', roles: ['super_admin'] },
  { id: 'consolidated_salary', label: 'Consolidated Salary', icon: Calculator, permissionSlug: 'consolidated_salary', roles: ['super_admin'] },
  { id: 'uniform_registry', label: 'Materials Registry', icon: Shirt, permissionSlug: 'uniform_registry' },
  { id: 'leave_requests', label: 'Leave Requests', icon: FileText, permissionSlug: 'leave_requests', roles: ['super_admin'] },
  { id: 'cancellation_requests', label: 'Cancellations', icon: Ban, permissionSlug: 'cancellation_requests', roles: ['super_admin'] },
  { id: 'notifications', label: 'Notifications', icon: Bell, permissionSlug: 'notifications', roles: ['super_admin'] },
  { id: 'admins', label: 'Admin Management', icon: Shield, permissionSlug: 'admins', roles: ['super_admin'] },
  { id: 'all_logs', label: 'All Logs', icon: History, permissionSlug: 'admins', roles: ['super_admin'] },
];

// Menus always visible to all users (including admin)
const ALWAYS_VISIBLE_SLUGS = ['dashboard'];

interface SidebarContentProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

function SidebarContent({ collapsed = false, onNavigate }: SidebarContentProps) {
  const { currentView, setCurrentView } = useAppStore();
  const { user, logout } = useAuthStore();
  // Badge counts: unread notifications + pending leave/cancellation requests.
  // Each sidebar item shows its own count badge when something comes in.
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [pendingLeaveCount, setPendingLeaveCount] = React.useState(0);
  const [pendingCancellationCount, setPendingCancellationCount] = React.useState(0);
  const [adminPermissions, setAdminPermissions] = React.useState<string[]>([]);
  const [logoutDialogOpen, setLogoutDialogOpen] = React.useState(false);
  // Online users count (presence) — shown below the company logo in both
  // expanded and collapsed sidebar states.
  const [onlineCount, setOnlineCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    const fetchPresence = async () => {
      try {
        const res = await fetch('/api/presence/online');
        const data = await res.json();
        if (data.success) setOnlineCount(data.data.count ?? null);
      } catch {
        // silent
      }
    };
    fetchPresence();
    const interval = setInterval(fetchPresence, 30000);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    // Refresh badge counts: every 30s, when the window regains focus, and
    // instantly when any page dispatches 'asm:refresh-badge-counts'
    // (e.g. after a leave/cancellation request is created or reviewed).
    const fetchCounts = async () => {
      try {
        const [notifRes, leaveRes, cancelRes] = await Promise.all([
          fetch('/api/notifications?limit=1'),
          fetch('/api/leave-requests?status=pending'),
          fetch('/api/cancellation-requests?status=pending'),
        ]);
        const notifData = await notifRes.json();
        if (notifData.success) {
          setUnreadCount(notifData.data.unreadCount || 0);
        }
        const leaveData = await leaveRes.json();
        if (leaveData.success) {
          setPendingLeaveCount((leaveData.data.leaveRequests || []).length);
        }
        const cancelData = await cancelRes.json();
        if (cancelData.success) {
          setPendingCancellationCount((cancelData.data.cancellationRequests || []).length);
        }
      } catch {
        // silent
      }
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 30000);
    window.addEventListener('focus', fetchCounts);
    window.addEventListener('asm:refresh-badge-counts', fetchCounts);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', fetchCounts);
      window.removeEventListener('asm:refresh-badge-counts', fetchCounts);
    };
  }, []);

  // Fetch admin permissions from the new Permission system
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
          // Get all slugs where granted is true OR always visible
          const grantedSlugs = [
            ...ALWAYS_VISIBLE_SLUGS,
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
        } catch { /* silent */ }
      }
    };
    fetchPermissions();
    // Refresh every 15 seconds for snappier permission updates
    const interval = setInterval(fetchPermissions, 15000);
    return () => clearInterval(interval);
  }, [user]);

  const handleNavClick = (view: AppView) => {
    setCurrentView(view);
    onNavigate?.();
  };

  const handleLogout = () => {
    setLogoutDialogOpen(true);
  };

  const confirmLogout = () => {
    logout();
    onNavigate?.();
    setLogoutDialogOpen(false);
  };

  // Role-based filtering with dynamic admin permissions
  const filteredNavItems = navItems.filter((item) => {
    // Super admin sees everything
    if (user?.role === 'super_admin') return true;
    // Always visible items are shown to everyone
    if (ALWAYS_VISIBLE_SLUGS.includes(item.permissionSlug)) return true;
    // Admin: check if they have been granted this permission
    return adminPermissions.includes(item.permissionSlug);
  });

  return (
    <div className="flex h-full flex-col bg-slate-900 border-r border-slate-700/50">
      {/* Logo Section */}
      <div className="flex shrink-0 items-center gap-3 px-4 py-5">
        <motion.img
          src="/logo_asm.png"
          alt="ASM"
          className="h-10 w-10 rounded-lg object-contain shrink-0"
          whileHover={{ rotate: 8, scale: 1.1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15 }}
        />
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span className="asm-gradient-text font-bold text-lg leading-tight">ASM</span>
            <span className="text-xs text-slate-400 truncate">
              Arabian Shield Manpower
            </span>
          </div>
        )}
      </div>

      {/* Online presence — always directly below the company logo.
          Expands to a labeled chip; collapses to a compact dot + count
          that stays centered inside the narrow rail. */}
      <div
        className={cn(
          'flex shrink-0 items-center',
          collapsed ? 'flex-col gap-1 pb-3 pt-1' : 'mx-4 mb-3 gap-2 rounded-lg border border-slate-700/60 bg-slate-800/50 px-3 py-1.5'
        )}
        title={onlineCount !== null ? `${onlineCount} user${onlineCount !== 1 ? 's' : ''} online` : undefined}
      >
        <PulseDot />
        {onlineCount !== null && (
          <span className={cn('tabular-nums text-slate-400', collapsed ? 'text-[10px]' : 'text-xs')}>
            {collapsed ? onlineCount : `${onlineCount} online`}
          </span>
        )}
      </div>

      <Separator className="bg-slate-700/50" />

      {/* Navigation — min-h-0 is REQUIRED here: as a flex item, the scroll
          box would otherwise grow to its content height (min-height:auto) and
          never scroll, pushing the footer off-screen on short viewports. */}
      <ScrollArea className="min-h-0 flex-1 overflow-hidden px-3 py-4">
        <StaggerContainer
          stagger={0.035}
          className="flex flex-col gap-1"
          key={collapsed ? 'collapsed' : 'expanded'}
        >
          {filteredNavItems.map((item) => {
            const isActive = currentView === item.id;
            const Icon = item.icon;
            // Count badge per item: unread notifications, pending leave
            // requests, pending cancellation requests.
            const badge =
              item.id === 'notifications' && unreadCount > 0
                ? { count: unreadCount, className: 'bg-blue-500' }
                : item.id === 'leave_requests' && pendingLeaveCount > 0
                ? { count: pendingLeaveCount, className: 'bg-amber-500' }
                : item.id === 'cancellation_requests' && pendingCancellationCount > 0
                ? { count: pendingCancellationCount, className: 'bg-red-500' }
                : null;

            return (
              <StaggerItem key={item.id} className="relative">
                <button
                  onClick={() => handleNavClick(item.id)}
                  className={cn(
                    'asm-nav-item group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 w-full text-left relative',
                    collapsed && 'justify-center px-2',
                    isActive
                      ? 'text-blue-400'
                      : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                  )}
                >
                  {/* Animated active pill (slides between items) */}
                  {isActive && (
                    <motion.span
                      layoutId="asm-nav-active-pill"
                      className="absolute inset-0 rounded-lg bg-blue-500/15 border border-blue-500/30"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <motion.span
                    className={cn(
                      'relative z-10 shrink-0',
                      !isActive && 'transition-transform duration-200 group-hover:scale-110 group-hover:-translate-y-0.5'
                    )}
                  >
                    <Icon className={cn('h-5 w-5', isActive && 'text-blue-400')} />
                  </motion.span>
                  {!collapsed && <span className="truncate relative z-10">{item.label}</span>}
                  {!collapsed && badge && (
                    <Badge
                      variant="default"
                      className={cn(
                        'ml-auto relative z-10 text-white text-[10px] px-1.5 py-0 min-w-[20px] h-5 flex items-center justify-center animate-pulse',
                        badge.className
                      )}
                    >
                      {badge.count > 99 ? '99+' : badge.count}
                    </Badge>
                  )}
                  {collapsed && badge && (
                    <span
                      className={cn(
                        'absolute -top-1 -right-1 z-10 flex h-4 min-w-4 px-1 items-center justify-center rounded-full text-[9px] font-bold text-white animate-pulse',
                        badge.className
                      )}
                    >
                      {badge.count > 9 ? '9+' : badge.count}
                    </span>
                  )}
                </button>

                {/* Tooltip when collapsed */}
                {collapsed && (
                  <span className="asm-nav-tooltip pointer-events-none absolute left-full ml-2 top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 opacity-0 shadow-xl transition-all duration-200 group-hover:opacity-100">
                    {item.label}
                  </span>
                )}
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </ScrollArea>

      <Separator className="bg-slate-700/50" />

      {/* User Info Section - Sticky Footer */}
      <div className={cn('mt-auto shrink-0', collapsed ? 'p-2' : 'p-3')}>
        {user && (
          <div
            className={cn(
              'flex items-center gap-3 rounded-lg bg-slate-800/50 p-3',
              collapsed && 'flex-col gap-2 p-2'
            )}
          >
            {/* Avatar doubles as the Profile button when collapsed */}
            <button
              type="button"
              onClick={() => handleNavClick('profile')}
              title="Profile"
              className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full font-semibold text-sm transition-transform hover:scale-105",
                user.role === 'super_admin'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-blue-500/20 text-blue-400'
              )}>
                {(user.name || user.email)
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            </button>
            {!collapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium text-white truncate">
                  {user.name || user.email}
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "mt-0.5 w-fit text-[10px] px-1.5 py-0 h-4",
                    user.role === 'super_admin'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                      : 'bg-slate-700 text-slate-300'
                  )}
                >
                  {user.role === 'super_admin' ? (
                    <span className="flex items-center gap-0.5"><Crown className="h-2.5 w-2.5" /> Super Admin</span>
                  ) : 'Admin'}
                </Badge>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'text-slate-400 hover:text-red-400 hover:bg-red-500/10 shrink-0',
                collapsed ? 'h-7 w-7' : 'h-8 w-8'
              )}
              onClick={handleLogout}
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Log Out</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Are you sure you want to log out? You will need to sign in again to access the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-slate-700 border-slate-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLogout}
              className="bg-red-500 hover:bg-red-600 text-white focus:ring-red-500/30 focus:ring-offset-slate-800 border-0"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AppSidebar() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  const isMobile = useIsMobile();

  // Mobile: Sheet-based sidebar
  if (isMobile) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-slate-900 border-slate-700/50">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
          </SheetHeader>
          <SidebarContent onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Collapsible sidebar
  return (
    <div
      className={cn(
        'h-screen sticky top-0 flex flex-col transition-all duration-300 border-r border-slate-700/50 bg-slate-900',
        sidebarOpen ? 'w-64' : 'w-[72px]'
      )}
    >
      <SidebarContent collapsed={!sidebarOpen} />

      {/* Collapse Toggle */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute -right-3 top-7 z-10 h-6 w-6 rounded-full border border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 shadow-md"
      >
        {sidebarOpen ? (
          <ChevronLeft className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}
