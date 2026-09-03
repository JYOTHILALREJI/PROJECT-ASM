'use client';

/**
 * Global Command Palette (Ctrl/Cmd + K)
 * -------------------------------------
 * One shortcut to jump anywhere:
 *  - Navigate to every page the user has access to
 *  - Search employees by name / id / trade / site (live API search)
 *  - Search sites
 *  - Quick actions: toggle sidebar, open profile, log out
 *
 * Built on cmdk so ↑/↓/↵ keyboard navigation works out of the box,
 * with framer-motion enter/exit polish via the Radix dialog.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Calendar,
  Bell,
  Shield,
  LogOut,
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
  User,
  FolderOpen,
  PanelLeft,
  Loader2,
} from 'lucide-react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore, type AppView } from '@/store/app-store';
import { cn } from '@/lib/utils';

interface EmployeeHit {
  id: string;
  employeeId: string;
  fullName: string;
  currentSite: string | null;
  trade: string | null;
  position: string | null;
}

interface SiteHit {
  id: string;
  siteName: string;
  clientName?: string | null;
  location?: string | null;
}

const PAGE_ITEMS: { view: AppView; label: string; icon: React.ElementType; keywords: string }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview stats' },
  { view: 'employees', label: 'Employees', icon: Users, keywords: 'workers staff directory' },
  { view: 'employee_hours_ledger', label: 'Employee Hours', icon: Clock, keywords: 'hours ledger timesheet' },
  { view: 'sites', label: 'Sites', icon: Building2, keywords: 'locations projects' },
  { view: 'camps', label: 'Camps', icon: Tent, keywords: 'accommodation' },
  { view: 'attendance', label: 'Attendance', icon: Calendar, keywords: 'present absent grid mark' },
  { view: 'attendance_copy', label: 'Attendance Copy', icon: Link2, keywords: 'share link' },
  { view: 'accounts', label: 'Accounts', icon: DollarSign, keywords: 'salary payroll finance' },
  { view: 'consolidated_salary', label: 'Consolidated Salary', icon: Calculator, keywords: 'payroll report excel' },
  { view: 'uniform_registry', label: 'Materials Registry', icon: Shirt, keywords: 'uniform stock inventory' },
  { view: 'documents', label: 'Documents', icon: FolderOpen, keywords: 'noc no objection certificate documents passport id visa scan' },
  { view: 'leave_requests', label: 'Leave Requests', icon: FileText, keywords: 'vacation time off' },
  { view: 'cancellation_requests', label: 'Cancellation Requests', icon: Ban, keywords: 'cancel exit' },
  { view: 'notifications', label: 'Notifications', icon: Bell, keywords: 'alerts unread' },
  { view: 'admins', label: 'Admin Management', icon: Shield, keywords: 'users permissions roles' },
  { view: 'all_logs', label: 'All Logs', icon: History, keywords: 'audit activity history' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [employeeHits, setEmployeeHits] = useState<EmployeeHit[]>([]);
  const [siteHits, setSiteHits] = useState<SiteHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const { user, logout } = useAuthStore();
  const { setCurrentView, setSelectedEmployeeId, setSidebarOpen, sidebarOpen } = useAppStore();

  const isSuperAdmin = user?.role === 'super_admin';

  // Global shortcut: Ctrl/Cmd + K toggles the palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // External open requests (header search button dispatches this)
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener('asm:open-command-palette', openHandler);
    return () => window.removeEventListener('asm:open-command-palette', openHandler);
  }, []);

  const go = useCallback(
    (view: AppView) => {
      setCurrentView(view);
      setOpen(false);
    },
    [setCurrentView]
  );

  // Debounced live search against employees + sites APIs
  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < 2 || !isSuperAdmin) {
      setEmployeeHits([]);
      setSiteHits([]);
      setSearching(false);
      return;
    }

    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const [empRes, siteRes] = await Promise.all([
          fetch(`/api/employees?search=${encodeURIComponent(trimmed)}&limit=6&status=active`),
          fetch(`/api/sites`),
        ]);
        if (seq !== searchSeq.current) return; // stale
        if (empRes.ok) {
          const data = await empRes.json();
          setEmployeeHits((data.data?.employees || []).slice(0, 6));
        }
        if (siteRes.ok) {
          const data = await siteRes.json();
          const sites = (data.data?.sites || data.data || []) as SiteHit[];
          const q = trimmed.toLowerCase();
          setSiteHits(
            sites
              .filter(
                (s) =>
                  s.siteName?.toLowerCase().includes(q) ||
                  s.clientName?.toLowerCase().includes(q) ||
                  s.location?.toLowerCase().includes(q)
              )
              .slice(0, 4)
          );
        }
      } catch {
        // silent — palette still works for navigation
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [query, open, isSuperAdmin]);

  const closeAnd = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  const hasLiveResults = employeeHits.length > 0 || siteHits.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <DialogContent className="overflow-hidden p-0 bg-slate-900/95 border-slate-700/60 shadow-2xl shadow-black/40 backdrop-blur-xl max-w-xl top-[18%] translate-y-0 gap-0 [&>button]:hidden rounded-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          className="bg-transparent rounded-xl"
        >
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search pages, employees, sites…"
              className="h-12 text-sm text-slate-100 placeholder:text-slate-500"
            />
            {searching && (
              <Loader2 className="absolute right-4 top-4 h-4 w-4 animate-spin text-blue-400" />
            )}
          </div>

          <CommandList className="max-h-[55vh] py-2 px-1 bg-transparent">
            <CommandEmpty className="py-8 text-center text-sm text-slate-500">
              No matching results.
            </CommandEmpty>

            <CommandGroup
              heading="Pages"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-500"
            >
              {PAGE_ITEMS.map((p) => {
                const Icon = p.icon;
                return (
                  <CommandItem
                    key={p.view}
                    value={`page ${p.label} ${p.keywords}`}
                    onSelect={closeAnd(() => go(p.view))}
                    className="group rounded-lg px-3 py-2.5 text-sm text-slate-300 data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-white cursor-pointer aria-selected:bg-blue-500/15"
                  >
                    <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-400 transition-colors group-data-[selected=true]:bg-blue-500/25 group-data-[selected=true]:text-blue-300">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    {p.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {employeeHits.length > 0 && (
              <CommandGroup
                heading="Employees"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-500"
              >
                {employeeHits.map((e) => (
                  <CommandItem
                    key={`emp-${e.id}`}
                    value={`employee ${e.fullName} ${e.employeeId} ${e.currentSite || ''} ${e.trade || e.position || ''}`}
                    onSelect={closeAnd(() => {
                      setSelectedEmployeeId(e.id);
                      setCurrentView('employee_detail');
                    })}
                    className="group rounded-lg px-3 py-2.5 text-sm text-slate-300 data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-white cursor-pointer"
                  >
                    <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-400 transition-colors group-data-[selected=true]:bg-blue-500/25 group-data-[selected=true]:text-blue-300">
                      <User className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.fullName}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[e.employeeId, e.trade || e.position, e.currentSite].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {siteHits.length > 0 && (
              <CommandGroup
                heading="Sites"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-500"
              >
                {siteHits.map((s) => (
                  <CommandItem
                    key={`site-${s.id}`}
                    value={`site ${s.siteName} ${s.clientName || ''} ${s.location || ''}`}
                    onSelect={closeAnd(() => go('sites'))}
                    className="group rounded-lg px-3 py-2.5 text-sm text-slate-300 data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-white cursor-pointer"
                  >
                    <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-400 transition-colors group-data-[selected=true]:bg-blue-500/25 group-data-[selected=true]:text-blue-300">
                      <Building2 className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.siteName}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[s.clientName, s.location].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup
              heading="Actions"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-500"
            >
              <CommandItem
                value="action toggle sidebar collapse expand menu"
                onSelect={closeAnd(() => setSidebarOpen(!sidebarOpen))}
                className="group rounded-lg px-3 py-2.5 text-sm text-slate-300 data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-white cursor-pointer"
              >
                <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-400 transition-colors group-data-[selected=true]:bg-blue-500/25 group-data-[selected=true]:text-blue-300">
                  <PanelLeft className="h-3.5 w-3.5" />
                </span>
                {sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              </CommandItem>
              <CommandItem
                value="action open profile account settings"
                onSelect={closeAnd(() => go('profile'))}
                className="group rounded-lg px-3 py-2.5 text-sm text-slate-300 data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-white cursor-pointer"
              >
                <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-400 transition-colors group-data-[selected=true]:bg-blue-500/25 group-data-[selected=true]:text-blue-300">
                  <User className="h-3.5 w-3.5" />
                </span>
                Open my profile
              </CommandItem>
              <CommandItem
                value="action log out sign out exit"
                onSelect={closeAnd(() => logout())}
                className="group rounded-lg px-3 py-2.5 text-sm text-red-400 data-[selected=true]:bg-red-500/15 data-[selected=true]:text-red-300 cursor-pointer"
              >
                <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-red-400/70 transition-colors group-data-[selected=true]:bg-red-500/25 group-data-[selected=true]:text-red-300">
                  <LogOut className="h-3.5 w-3.5" />
                </span>
                Log out
              </CommandItem>
            </CommandGroup>
          </CommandList>

          <div className={cn(
            'flex items-center justify-between border-t border-slate-700/60 px-4 py-2 text-[11px] text-slate-500',
          )}>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-slate-700 bg-slate-800 px-1 font-mono">↑↓</kbd>
              navigate
              <kbd className="ml-2 rounded border border-slate-700 bg-slate-800 px-1 font-mono">↵</kbd>
              open
              <kbd className="ml-2 rounded border border-slate-700 bg-slate-800 px-1 font-mono">esc</kbd>
              close
            </span>
            <span>{isSuperAdmin ? 'ASM Command' : 'Limited access'}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
