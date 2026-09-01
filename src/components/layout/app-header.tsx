'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Menu,
  Bell,
  LogOut,
  User,
  Search,
  Clock3,
  CheckCheck,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { PulseDot } from '@/components/motion';
import { cn } from '@/lib/utils';

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
  employee_detail: 'Employee Detail',
  employee_add: 'Add Employee',
  employee_batch_add: 'Batch Add Employees',
  camps: 'Camps',
  camp_detail: 'Camp Detail',
  profile: 'Profile',
};

interface NotificationHit {
  id: string;
  title?: string;
  message?: string;
  body?: string;
  isRead?: boolean;
  read?: boolean;
  createdAt: string;
  type?: string | null;
}

function useClock() {
  // Lazy init is safe: this header only mounts client-side after auth resolves.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function AppHeader() {
  const { currentView, setSidebarOpen } = useAppStore();
  const { user, logout } = useAuthStore();
  const isMobile = useIsMobile();
  const now = useClock();

  const title = viewTitles[currentView] || 'Dashboard';

  const [unreadCount, setUnreadCount] = useState(0);
  const [recent, setRecent] = useState<NotificationHit[]>([]);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifTick, setNotifTick] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/notifications?limit=6');
        const data = await res.json();
        if (data.success) {
          setUnreadCount(data.data.unreadCount || 0);
          setRecent(data.data.notifications || []);
        }
      } catch {
        // silent
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [notifTick]);

  // Online user count (presence)
  useEffect(() => {
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

  const handleLogoutClick = () => setLogoutDialogOpen(true);
  const confirmLogout = () => {
    logout();
    setLogoutDialogOpen(false);
  };

  const openNotifications = () => {
    setBellOpen(false);
    useAppStore.getState().setCurrentView('notifications');
  };

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifTick((t) => t + 1);
    } catch {
      // silent
    }
  };

  const timeStr = now
    ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
  const dateStr = now
    ? now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
    : '';

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-md px-4 md:px-6 py-3">
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
          {/* Animated title crossfade */}
          <div className="relative h-7 overflow-hidden shrink-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.h1
                key={title}
                initial={{ y: 18, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -18, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="text-lg font-semibold text-white whitespace-nowrap"
              >
                {title}
              </motion.h1>
            </AnimatePresence>
          </div>

          {/* Portal slot — pages can render a search bar (or other controls)
              directly into the header via createPortal(..., 'header-controls-slot'). */}
          <div id="header-controls-slot" className="flex-1 min-w-0 max-w-md ml-4 hidden sm:block" />
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2">
          {/* Portal slot for page-specific action buttons. */}
          <div id="header-actions-slot" className="flex items-center gap-2" />

          {/* Live clock — hidden on small screens */}
          <div className="hidden lg:flex items-center gap-2.5 rounded-lg border border-slate-700/60 bg-slate-800/50 px-3 py-1.5 mr-1">
            <Clock3 className="h-3.5 w-3.5 text-blue-400" />
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-xs text-slate-200 tabular-nums">{timeStr}</span>
              <span className="text-[10px] text-slate-500">{dateStr}</span>
            </div>
          </div>

          {/* Online presence */}
          {onlineCount !== null && (
            <div
              className="hidden md:flex items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/50 px-2.5 py-1.5 mr-1"
              title={`${onlineCount} user${onlineCount !== 1 ? 's' : ''} online`}
            >
              <PulseDot />
              <span className="text-xs text-slate-300 tabular-nums">{onlineCount}</span>
            </div>
          )}

          {/* Command palette trigger */}
          <button
            onClick={() => window.dispatchEvent(new Event('asm:open-command-palette'))}
            className="group hidden sm:flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/50 px-3 py-1.5 text-sm text-slate-400 transition-all hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Open command palette (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
            <span className="hidden xl:inline">Search…</span>
            <kbd className="hidden xl:flex h-5 items-center gap-0.5 rounded border border-slate-700 bg-slate-900 px-1.5 font-mono text-[10px] text-slate-500">
              Ctrl K
            </kbd>
          </button>

          {/* Notification Bell with popover */}
          <Popover open={bellOpen} onOpenChange={setBellOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative text-slate-400 hover:text-white"
                aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
              >
                <Bell
                  className={cn('h-5 w-5', unreadCount > 0 && 'asm-bell-ring text-blue-400')}
                />
                {unreadCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </motion.span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-80 p-0 bg-slate-900/95 border-slate-700/60 backdrop-blur-xl rounded-xl shadow-2xl shadow-black/40"
            >
              <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
                <span className="text-sm font-semibold text-white">Notifications</span>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <CheckCheck className="h-3 w-3" /> Mark all read
                    </button>
                  )}
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700"
                  >
                    {unreadCount} new
                  </Badge>
                </div>
              </div>
              <ScrollArea className="max-h-80">
                {recent.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <Bell className="h-8 w-8 text-slate-700" />
                    <p className="text-xs text-slate-500">You&apos;re all caught up!</p>
                  </div>
                ) : (
                  recent.map((n, i) => {
                    const isUnread = !(n.isRead ?? n.read);
                    return (
                      <motion.button
                        key={n.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        onClick={openNotifications}
                        className={cn(
                          'flex w-full items-start gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition-colors hover:bg-slate-800/60',
                          isUnread && 'bg-blue-500/5'
                        )}
                      >
                        <span
                          className={cn(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            isUnread ? 'bg-blue-400' : 'bg-slate-700'
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-200">
                            {n.title || 'Notification'}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {n.message || n.body || ''}
                          </span>
                        </span>
                        <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-600" />
                      </motion.button>
                    );
                  })
                )}
              </ScrollArea>
              <button
                onClick={openNotifications}
                className="w-full border-t border-slate-700/60 py-2.5 text-center text-xs font-medium text-blue-400 transition-colors hover:bg-slate-800/60 hover:text-blue-300"
              >
                View all notifications
              </button>
            </PopoverContent>
          </Popover>

          {/* User Dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 px-2 md:px-3 text-slate-300 hover:text-white hover:bg-slate-800"
                >
                  <motion.div
                    whileHover={{ scale: 1.08 }}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-semibold text-xs"
                  >
                    {(user.name || user.email)
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </motion.div>
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
