'use client';

import React from 'react';
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
  { id: 'employee_hours_ledger', label: 'Employee Hours', icon: Clock, permissionSlug: 'employees', roles: ['super_admin'] },
  { id: 'sites', label: 'Sites', icon: Building2, permissionSlug: 'sites', roles: ['super_admin'] },
  { id: 'attendance', label: 'Attendance', icon: Calendar, permissionSlug: 'attendance', roles: ['super_admin'] },
  { id: 'attendance_copy', label: 'Attendance Copy', icon: Link2, permissionSlug: 'attendance', roles: ['super_admin'] },
  { id: 'accounts', label: 'Accounts', icon: DollarSign, permissionSlug: 'accounts', roles: ['super_admin'] },
  { id: 'consolidated_salary', label: 'Consolidated Salary', icon: Calculator, permissionSlug: 'consolidated_salary', roles: ['super_admin'] },
  { id: 'uniform_registry', label: 'Uniform Registry', icon: Shirt, permissionSlug: 'uniform_registry' },
  { id: 'leave_requests', label: 'Leave Requests', icon: FileText, permissionSlug: 'leave_requests', roles: ['super_admin'] },
  { id: 'cancellation_requests', label: 'Cancellations', icon: Ban, permissionSlug: 'cancellation_requests', roles: ['super_admin'] },
  { id: 'notifications', label: 'Notifications', icon: Bell, permissionSlug: 'notifications', roles: ['super_admin'] },
  { id: 'admins', label: 'Admin Management', icon: Shield, permissionSlug: 'admins', roles: ['super_admin'] },
];

// Menus always visible to all users (including admin)
const ALWAYS_VISIBLE_SLUGS = ['dashboard', 'uniform_registry'];

interface SidebarContentProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

function SidebarContent({ collapsed = false, onNavigate }: SidebarContentProps) {
  const { currentView, setCurrentView } = useAppStore();
  const { user, logout } = useAuthStore();
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [adminPermissions, setAdminPermissions] = React.useState<string[]>([]);
  const [logoutDialogOpen, setLogoutDialogOpen] = React.useState(false);

  React.useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/notifications?limit=1');
        const data = await res.json();
        if (data.success) {
          setUnreadCount(data.data.unreadCount || 0);
        }
      } catch {
        // silent
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
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
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500 font-bold text-white text-lg shrink-0">
          A
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-white text-lg leading-tight">ASM</span>
            <span className="text-xs text-slate-400 truncate">
              Arabian Shield Manpower
            </span>
          </div>
        )}
      </div>

      <Separator className="bg-slate-700/50" />

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {filteredNavItems.map((item) => {
            const isActive = currentView === item.id;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 w-full text-left',
                  collapsed && 'justify-center px-2',
                  isActive
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent'
                )}
              >
                <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-blue-400')} />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && item.id === 'notifications' && unreadCount > 0 && (
                  <Badge
                    variant="default"
                    className="ml-auto bg-blue-500 text-white text-[10px] px-1.5 py-0 min-w-[20px] h-5 flex items-center justify-center"
                  >
                    {unreadCount}
                  </Badge>
                )}
                {collapsed && item.id === 'notifications' && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-slate-700/50" />

      {/* User Info Section - Sticky Footer */}
      <div className="p-3 mt-auto">
        {user && (
          <div
            className={cn(
              'flex items-center gap-3 rounded-lg bg-slate-800/50 p-3',
              collapsed && 'justify-center p-2'
            )}
          >
            <div className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full font-semibold text-sm shrink-0",
              user.role === 'super_admin'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-blue-500/20 text-blue-400'
            )}>
              {user.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium text-white truncate">
                  {user.name}
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
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
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
