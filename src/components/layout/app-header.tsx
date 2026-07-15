'use client';

import React, { useEffect, useState } from 'react';
import { Menu, Bell, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';
import { useIsMobile } from '@/hooks/use-mobile';

const viewTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  employees: 'Employee Management',
  sites: 'Sites',
  attendance: 'Attendance Tracking',
  attendance_copy: 'Attendance Copy',
  all_logs: 'All Logs',
  uniform_registry: 'Materials Registry',
  leave_requests: 'Leave Requests',
  cancellation_requests: 'Cancellation Requests',
  notifications: 'Notifications',
  admins: 'Admin Management',
  accounts: 'Accounts',
  advance: 'Advance Management',
  consolidated_salary: 'Consolidated Salary',
  employee_hours_ledger: 'Employee Hours Ledger',
  profile: 'Profile',
};

export function AppHeader() {
  const { currentView, setSidebarOpen } = useAppStore();
  const { user, logout } = useAuthStore();
  const isMobile = useIsMobile();

  const title = viewTitles[currentView] || 'Dashboard';

  const [unreadCount, setUnreadCount] = useState(0);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  useEffect(() => {
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

  const handleLogoutClick = () => {
    setLogoutDialogOpen(true);
  };

  const confirmLogout = () => {
    logout();
    setLogoutDialogOpen(false);
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm px-4 md:px-6 py-3">
        {/* Left Section */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-white shrink-0"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-lg font-semibold text-white shrink-0">{title}</h1>

          {/* Portal slot — pages can render a search bar (or other controls)
              directly into the header via createPortal(..., 'header-controls-slot').
              Only rendered when a page populates it (currently Accounts and
              Consolidated Salary). The slot grows to fill available space so
              the search bar stretches naturally on desktop. */}
          <div id="header-controls-slot" className="flex-1 min-w-0 max-w-md ml-4 hidden sm:block" />
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2">
          {/* Notification Bell */}
          <Button
            variant="ghost"
            size="icon"
            className="relative text-slate-400 hover:text-white"
            onClick={() => useAppStore.getState().setCurrentView('notifications')}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </Button>

          {/* User Dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 px-2 md:px-3 text-slate-300 hover:text-white hover:bg-slate-800"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-semibold text-xs">
                    {(user.name || user.email)
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <span className="hidden md:inline text-sm font-medium truncate max-w-[120px]">
                    {user.name || user.email}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 bg-slate-800 border-slate-700"
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-white">{user.name || user.email}</p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                    <Badge
                      variant="secondary"
                      className="mt-1 w-fit text-[10px] bg-slate-700 text-slate-300"
                    >
                      {user.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                    </Badge>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-slate-700" />
                <DropdownMenuItem
                  className="text-slate-300 focus:bg-slate-700 focus:text-white cursor-pointer"
                  onClick={() => useAppStore.getState().setCurrentView('profile')}
                >
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-700" />
                <DropdownMenuItem
                  className="text-red-400 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
                  onClick={handleLogoutClick}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

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
    </>
  );
}
