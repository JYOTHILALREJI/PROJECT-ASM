'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Menu,
  Search,
  Clock3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  documents: 'Documents',
  noc_view: 'View NOC',
  employee_hours_ledger: 'Employee Hours Ledger',
  employee_detail: 'Employee Detail',
  employee_add: 'Add Employee',
  employee_batch_add: 'Batch Add Employees',
  camps: 'Camps',
  camp_detail: 'Camp Detail',
  profile: 'Profile',
  settings: 'Settings',
};

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
  const isMobile = useIsMobile();
  const now = useClock();

  const title = viewTitles[currentView] || 'Dashboard';

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
              directly into the header via createPortal(..., 'header-controls-slot').
              Flexes to fill the remaining width so page controls never crowd
              or overlap the action buttons on the right. */}
          <div id="header-controls-slot" className="flex-1 min-w-0 ml-4 hidden sm:flex justify-start" />
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

          {/* Profile & logout now live in the sidebar user card. */}
        </div>
      </header>

    </>
  );
}
