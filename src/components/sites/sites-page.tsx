'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Building2,
  Users,
  Eye,
  Trash2,
  UserMinus,
  Plus,
  Search,
  Star,
  AlertTriangle,
  ChevronLeft,
  ChevronDown,
  Pencil,
  UserPlus,
  MapPin,
  X,
  Loader2,
  Crown,
  ShieldCheck,
  FileSpreadsheet,
  Power,
  PowerOff,
  MoreHorizontal,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { AttendanceSheet } from '@/components/attendance/attendance-sheet';

/* ───────── types ───────── */
interface Site {
  id: string;
  name: string;
  clientName?: string | null;
  projectName?: string | null;
  projectId?: string | null;
  isActive: boolean;
  createdAt: string;
  employeeCount: number;
}

interface SiteEmployee {
  id: string;
  fullName: string;
  employeeId: string;
  position: string | null;
  nationality: string | null;
  rating: number;
  currentSite: string | null;
  status: string;
  photo: string | null;
  isTeamLeader: boolean;
  teamLeaderSiteId: string | null;
  isSupervisor: boolean;
  supervisorSiteId: string | null;
  trade: string | null;
}

interface AllEmployee {
  id: string;
  fullName: string;
  employeeId: string;
  position: string | null;
  nationality: string | null;
  currentSite: string | null;
  status: string;
  trade: string | null;
}

type SubView = 'list' | 'employees';

/* ───────── Star Rating ───────── */
function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25 && rating - fullStars < 0.75;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
  const isFull5 = rating >= 4.75;

  return (
    <div className="flex items-center gap-0.5">
      {isFull5 ? (
        Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
        ))
      ) : (
        <>
          {Array.from({ length: fullStars }).map((_, i) => (
            <Star key={`full-${i}`} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          ))}
          {hasHalf && (
            <div className="relative">
              <Star className="h-3.5 w-3.5 text-slate-600" />
              <div className="absolute inset-0 overflow-hidden w-1/2">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              </div>
            </div>
          )}
          {Array.from({ length: emptyStars }).map((_, i) => (
            <Star key={`empty-${i}`} className="h-3.5 w-3.5 text-slate-600" />
          ))}
        </>
      )}
      <span className="text-xs text-slate-400 ml-1 font-medium">{rating.toFixed(1)}</span>
    </div>
  );
}

/* ───────── Site Cards Grid ───────── */
function SiteCardsGrid({
  sites,
  search,
  loading,
  onSearchChange,
  onViewEmployees,
  onDeleteSite,
  onEditSite,
  onToggleActive,
  onAttendanceSheet,
}: {
  sites: Site[];
  search: string;
  loading: boolean;
  onSearchChange: (s: string) => void;
  onViewEmployees: (site: Site) => void;
  onDeleteSite: (site: Site) => void;
  onEditSite: (site: Site) => void;
  onToggleActive: (site: Site) => void;
  onAttendanceSheet: (site: Site) => void;
}) {
  const filteredSites = sites.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.clientName && s.clientName.toLowerCase().includes(search.toLowerCase())) ||
    (s.projectName && s.projectName.toLowerCase().includes(search.toLowerCase())) ||
    (s.projectId && s.projectId.toLowerCase().includes(search.toLowerCase()))
  );

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Group filtered sites by clientName. Sites with no client go into a
  // dedicated "Unassigned Client" group so they're still visible.
  const groupedByClient = useMemo(() => {
    const groups = new Map<string, Site[]>();
    const unassignedKey = '__unassigned__';
    for (const s of filteredSites) {
      const key = (s.clientName && s.clientName.trim()) ? s.clientName.trim() : unassignedKey;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    // Convert to array and sort alphabetically by client name, with the
    // "unassigned" group always last.
    return Array.from(groups.entries())
      .sort((a, b) => {
        if (a[0] === unassignedKey) return 1;
        if (b[0] === unassignedKey) return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([client, sitesList]) => ({
        client,
        sites: sitesList.sort((x, y) => x.name.localeCompare(y.name)),
      }));
  }, [filteredSites]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-52 bg-slate-800 rounded-xl" />
        ))}
      </div>
    );
  }

  if (filteredSites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Building2 className="h-12 w-12 text-slate-600 mb-3" />
        <p className="text-slate-400 text-lg font-medium">No sites found</p>
        <p className="text-slate-500 text-sm mt-1">
          {search ? 'Try a different search term.' : 'No sites in this category.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {groupedByClient.map(({ client, sites: sitesList }) => {
        const isUnassigned = client === '__unassigned__';
        const clientLabel = isUnassigned ? 'Unassigned Client' : client;
        const totalEmployeesInGroup = sitesList.reduce((sum, s) => sum + s.employeeCount, 0);
        return (
          <div key={client} className="space-y-3">
            {/* Client group header */}
            <div className="flex items-center gap-3 pb-2 border-b border-slate-700/60">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                <Building2 className="h-4 w-4 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white truncate uppercase tracking-wide">
                  {clientLabel}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {sitesList.length} site{sitesList.length !== 1 ? 's' : ''} · {totalEmployeesInGroup} employee{totalEmployeesInGroup !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Site cards in this client group */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sitesList.map((site) => (
                <Card
                  key={site.id}
                  className={cn(
                    "border-slate-700/50 hover:border-slate-600/50 transition-all group",
                    site.isActive ? "bg-slate-800/50" : "bg-slate-800/30 opacity-80"
                  )}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                          site.isActive
                            ? "bg-emerald-500/10 group-hover:bg-emerald-500/20"
                            : "bg-slate-600/20 group-hover:bg-slate-600/30"
                        )}>
                          <Building2 className={cn(
                            "h-5 w-5",
                            site.isActive ? "text-emerald-400" : "text-slate-500"
                          )} />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base text-white truncate">
                            {site.name}
                          </CardTitle>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Created {formatDate(site.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {/* Active/Inactive Toggle */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-8 w-8 shrink-0",
                            site.isActive
                              ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                              : "text-slate-500 hover:text-slate-400 hover:bg-slate-500/10"
                          )}
                          onClick={() => onToggleActive(site)}
                          title={site.isActive ? 'Deactivate site' : 'Activate site'}
                        >
                          {site.isActive ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 shrink-0"
                          onClick={() => onEditSite(site)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                          onClick={() => onDeleteSite(site)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {/* Project & Project ID info */}
                    {(site.projectName || site.projectId) && (
                      <div className="space-y-0.5">
                        {site.projectName && (
                          <p className="text-xs text-slate-400 truncate">
                            <span className="text-slate-500">Project:</span> {site.projectName}
                          </p>
                        )}
                        {site.projectId && (
                          <p className="text-xs text-slate-400 truncate">
                            <span className="text-slate-500">Project ID:</span>{' '}
                            <span className="font-mono text-amber-300">{site.projectId}</span>
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Users className="h-4 w-4" />
                      <span>
                        <span className="text-white font-semibold">{site.employeeCount}</span>{' '}
                        {site.employeeCount === 1 ? 'employee' : 'employees'}
                      </span>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1 bg-slate-700/50 border-slate-600 text-slate-200 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 gap-2 transition-all"
                          onClick={() => onViewEmployees(site)}
                        >
                          <Eye className="h-4 w-4" />
                          View Employees
                        </Button>
                        <Button
                          variant="outline"
                          className="bg-slate-700/50 border-slate-600 text-slate-200 hover:bg-blue-600 hover:text-white hover:border-blue-600 gap-2 transition-all shrink-0"
                          onClick={() => onAttendanceSheet(site)}
                          title="Attendance Sheet"
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────── Add Employee Combobox ───────── */
function AddEmployeeCombobox({
  allEmployees,
  currentSiteName,
  currentSiteEmployeeIds,
  onAdd,
  loading,
}: {
  allEmployees: AllEmployee[];
  currentSiteName: string;
  currentSiteEmployeeIds: Set<string>;
  onAdd: (employee: AllEmployee) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return allEmployees;
    const q = filter.toLowerCase();
    return allEmployees.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q) ||
        (e.position && e.position.toLowerCase().includes(q)) ||
        (e.trade && e.trade.toLowerCase().includes(q))
    );
  }, [allEmployees, filter]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={loading}
          className="bg-slate-700/50 border-slate-600 text-slate-200 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 gap-2 transition-all"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Add Employee
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-slate-800 border-slate-600" align="start">
        <Command className="bg-slate-800">
          <CommandInput
            placeholder="Search employees..."
            value={filter}
            onValueChange={setFilter}
            className="text-white"
          />
          <CommandList className="max-h-64">
            <CommandEmpty className="text-slate-400">No employees found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((emp) => {
                const isAlreadyInSite = currentSiteEmployeeIds.has(emp.id);
                const isFromAnotherSite = emp.currentSite && emp.currentSite !== currentSiteName;
                const isIdle = !emp.currentSite;

                return (
                  <CommandItem
                    key={emp.id}
                    value={`${emp.fullName} ${emp.employeeId}`}
                    onSelect={() => {
                      if (!isAlreadyInSite) {
                        onAdd(emp);
                        setOpen(false);
                        setFilter('');
                      }
                    }}
                    className={cn(
                      'text-slate-200 data-[selected=true]:bg-slate-700 data-[selected=true]:text-white py-2.5',
                      isAlreadyInSite && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm truncate">{emp.fullName}</span>
                        {isAlreadyInSite && (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0 shrink-0">
                            Current
                          </Badge>
                        )}
                        {isFromAnotherSite && (
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5">
                            <MapPin className="h-2.5 w-2.5" />
                            {emp.currentSite}
                          </Badge>
                        )}
                        {isIdle && (
                          <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-[10px] px-1.5 py-0 shrink-0">
                            Idle
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {emp.employeeId}
                        {emp.trade ? ` · ${emp.trade}` : emp.position ? ` · ${emp.position}` : ''}
                      </span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ───────── Client Name Combobox ───────── */
function ClientCombobox({
  clients,
  value,
  onChange,
}: {
  clients: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track whether the user is currently typing a brand-new client name that
  // doesn't match any existing entry. Used to show the "Add new" hint.
  const trimmedFilter = filter.trim();
  const isNewClient = trimmedFilter.length > 0 && !clients.some(
    (c) => c.toLowerCase() === trimmedFilter.toLowerCase(),
  );

  const filtered = useMemo(() => {
    if (!trimmedFilter) return clients;
    const q = trimmedFilter.toLowerCase();
    return clients.filter((c) => c.toLowerCase().includes(q));
  }, [clients, trimmedFilter]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const selectClient = (client: string) => {
    onChange(client);
    setOpen(false);
    setFilter('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center justify-between w-full h-10 rounded-lg border px-3 text-sm transition-colors text-left',
          value
            ? 'bg-slate-900/60 border-slate-600 text-white'
            : 'bg-slate-900/40 border-slate-600 text-slate-400',
          'hover:border-blue-500/50 hover:bg-slate-900/80',
        )}
      >
        <span className="truncate flex-1">
          {value || 'Select or type a new client...'}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-500 shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl shadow-black/40 overflow-hidden">
          {/* Search / new-client input */}
          <div className="p-2 border-b border-slate-700">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search or type a new client name..."
              className="w-full h-8 px-3 bg-slate-900 border border-slate-600 rounded-md text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && trimmedFilter) {
                  e.preventDefault();
                  selectClient(trimmedFilter);
                }
              }}
            />
          </div>

          <div className="max-h-56 overflow-y-auto">
            {/* Add new client option (if the typed text isn't an existing client) */}
            {isNewClient && (
              <button
                type="button"
                onClick={() => selectClient(trimmedFilter)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-blue-500/10 text-blue-300 border-b border-slate-700/50"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Add new client: <span className="font-medium">&ldquo;{trimmedFilter}&rdquo;</span>
                </span>
              </button>
            )}

            {filtered.length === 0 && !isNewClient ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">
                No clients found. Type above to add a new one.
              </div>
            ) : (
              <div>
                {filtered.length > 0 && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    Existing clients
                  </div>
                )}
                {filtered.map((client) => (
                  <button
                    key={client}
                    type="button"
                    onClick={() => selectClient(client)}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-slate-700/50',
                      client === value ? 'bg-slate-700/70 text-emerald-400' : 'text-slate-300',
                    )}
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate flex-1">{client}</span>
                    {client === value && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear selection button */}
          {value && (
            <div className="border-t border-slate-700 p-1.5">
              <button
                type="button"
                onClick={() => selectClient('')}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              >
                <X className="h-3 w-3" />
                Clear client
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── Main Component ───────── */
export function SitesPage() {
  // Sub view management
  const [subView, setSubView] = useState<SubView>('list');
  const [viewSite, setViewSite] = useState<Site | null>(null);

  // Sites list state
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('active');

  // Add/Edit/Delete site dialogs
  const [addSiteName, setAddSiteName] = useState('');
  const [addSiteClientName, setAddSiteClientName] = useState('');
  const [addSiteProjectName, setAddSiteProjectName] = useState('');
  const [addSiteProjectId, setAddSiteProjectId] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  const [editSiteTarget, setEditSiteTarget] = useState<Site | null>(null);
  const [editSiteName, setEditSiteName] = useState('');
  const [editSiteClientName, setEditSiteClientName] = useState('');
  const [editSiteProjectName, setEditSiteProjectName] = useState('');
  const [editSiteProjectId, setEditSiteProjectId] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const [deleteSiteTarget, setDeleteSiteTarget] = useState<Site | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Employee list state
  const [siteEmployees, setSiteEmployees] = useState<SiteEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmps, setSelectedEmps] = useState<Set<string>>(new Set());

  // Remove employees state
  const [showRemoveEmpDialog, setShowRemoveEmpDialog] = useState(false);
  const [removeEmpLoading, setRemoveEmpLoading] = useState(false);

  // Add employee state
  const [allEmployees, setAllEmployees] = useState<AllEmployee[]>([]);
  const [loadingAllEmployees, setLoadingAllEmployees] = useState(false);
  const [addingEmployee, setAddingEmployee] = useState(false);

  // Attendance sheet state
  const [attendanceSite, setAttendanceSite] = useState<Site | null>(null);

  // Team Leader / Supervisor assignment confirmation
  const [replaceTLDialog, setReplaceTLDialog] = useState<{
    open: boolean;
    emp: SiteEmployee | null;
    existingTL: { id: string; fullName: string } | null;
  }>({ open: false, emp: null, existingTL: null });
  const [replaceSupervisorDialog, setReplaceSupervisorDialog] = useState<{
    open: boolean;
    emp: SiteEmployee | null;
    existingSupervisor: { id: string; fullName: string } | null;
  }>({ open: false, emp: null, existingSupervisor: null });
  const [assignLoading, setAssignLoading] = useState(false);

  // Available clients (for the Client Name combobox in Add/Edit dialogs)
  const [availableClients, setAvailableClients] = useState<string[]>([]);

  /* ── Fetch sites ── */
  const fetchSites = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/sites');
      const json = await res.json();
      if (json.success) {
        setSites(json.data.sites || []);
      }
    } catch {
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Fetch available clients (distinct client names) ── */
  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch('/api/sites/clients');
      const json = await res.json();
      if (json.success) {
        setAvailableClients(json.data.clients || []);
      }
    } catch {
      setAvailableClients([]);
    }
  }, []);

  useEffect(() => {
    fetchSites();
    fetchClients();
  }, [fetchSites, fetchClients]);

  /* ── Split sites by active status ── */
  const activeSites = useMemo(() => sites.filter((s) => s.isActive), [sites]);
  const inactiveSites = useMemo(() => sites.filter((s) => !s.isActive), [sites]);

  /* ── Fetch site employees ── */
  const fetchSiteEmployees = useCallback(async (siteName: string) => {
    try {
      setLoadingEmployees(true);
      const res = await fetch('/api/employees?limit=1000&status=all');
      const json = await res.json();
      if (json.success) {
        const emps = (json.data.employees || []).filter(
          (e: SiteEmployee) => e.currentSite === siteName && e.status !== 'deleted'
        );
        setSiteEmployees(emps);
      }
    } catch {
      setSiteEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  /* ── Fetch all employees (for add dropdown) ── */
  const fetchAllEmployees = useCallback(async () => {
    try {
      setLoadingAllEmployees(true);
      const res = await fetch('/api/employees?limit=1000&status=active');
      const json = await res.json();
      if (json.success) {
        setAllEmployees(
          (json.data.employees || []).map((e: AllEmployee) => ({
            id: e.id,
            fullName: e.fullName,
            employeeId: e.employeeId,
            position: e.position,
            nationality: e.nationality,
            currentSite: e.currentSite,
            status: e.status,
            trade: e.trade,
          }))
        );
      }
    } catch {
      setAllEmployees([]);
    } finally {
      setLoadingAllEmployees(false);
    }
  }, []);

  /* ── View employees (switch to sub-view) ── */
  const handleViewEmployees = useCallback((site: Site) => {
    setViewSite(site);
    setSelectedEmps(new Set());
    setEmpSearch('');
    setSubView('employees');
    fetchSiteEmployees(site.name);
    fetchAllEmployees();
  }, [fetchSiteEmployees, fetchAllEmployees]);

  /* ── Back to sites list ── */
  const handleBackToList = useCallback(() => {
    setSubView('list');
    setViewSite(null);
    setSiteEmployees([]);
    setSelectedEmps(new Set());
    setEmpSearch('');
    fetchSites();
  }, [fetchSites]);

  /* ── Toggle site active status ── */
  const handleToggleActive = useCallback(async (site: Site) => {
    try {
      const res = await fetch('/api/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: site.id,
          name: site.name,
          clientName: site.clientName,
          projectName: site.projectName,
          projectId: site.projectId,
          isActive: !site.isActive,
        }),
      });
      const json = await res.json();
      if (json.success) {
        fetchSites();
        toast({
          title: site.isActive ? 'Site Deactivated' : 'Site Activated',
          description: `"${site.name}" has been ${site.isActive ? 'deactivated' : 'activated'}.`,
        });
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to update site', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update site', variant: 'destructive' });
    }
  }, [fetchSites]);

  /* ── Add site ── */
  const handleAddSite = useCallback(async () => {
    if (!addSiteName.trim()) return;
    try {
      setAddLoading(true);
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addSiteName.trim(),
          clientName: addSiteClientName.trim() || undefined,
          projectName: addSiteProjectName.trim() || undefined,
          projectId: addSiteProjectId.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setAddSiteName('');
        setAddSiteClientName('');
        setAddSiteProjectName('');
        setAddSiteProjectId('');
        setShowAddDialog(false);
        fetchSites();
        fetchClients();
        toast({ title: 'Site Created', description: `"${addSiteName.trim()}" has been added.` });
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to create site', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to create site', variant: 'destructive' });
    } finally {
      setAddLoading(false);
    }
  }, [addSiteName, addSiteClientName, addSiteProjectName, addSiteProjectId, fetchSites, fetchClients]);

  /* ── Edit site ── */
  const handleEditSite = useCallback(async () => {
    if (!editSiteTarget || !editSiteName.trim()) return;
    try {
      setEditLoading(true);
      const res = await fetch('/api/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editSiteTarget.id,
          name: editSiteName.trim(),
          clientName: editSiteClientName.trim(),
          projectName: editSiteProjectName.trim(),
          projectId: editSiteProjectId.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setEditSiteTarget(null);
        setEditSiteName('');
        setEditSiteClientName('');
        setEditSiteProjectName('');
        setEditSiteProjectId('');
        fetchSites();
        fetchClients();
        // Update viewSite name if we're viewing this site's employees
        if (viewSite && viewSite.id === editSiteTarget.id) {
          setViewSite((prev) => prev ? { ...prev, name: editSiteName.trim(), clientName: editSiteClientName.trim(), projectName: editSiteProjectName.trim(), projectId: editSiteProjectId.trim() } : null);
        }
        toast({ title: 'Site Updated', description: `Site details updated successfully.` });
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to update site', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update site', variant: 'destructive' });
    } finally {
      setEditLoading(false);
    }
  }, [editSiteTarget, editSiteName, editSiteClientName, editSiteProjectName, editSiteProjectId, fetchSites, fetchClients, viewSite]);

  /* ── Delete site ── */
  const handleDeleteSite = useCallback(async () => {
    if (!deleteSiteTarget) return;
    try {
      setDeleteLoading(true);
      const res = await fetch('/api/sites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteSiteTarget.id }),
      });
      const json = await res.json();
      if (json.success) {
        setDeleteSiteTarget(null);
        fetchSites();
        fetchClients();
        toast({ title: 'Site Deleted', description: `"${deleteSiteTarget.name}" has been removed.` });
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to delete site', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete site', variant: 'destructive' });
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteSiteTarget, fetchSites, fetchClients]);

  /* ── Remove selected employees from site ── */
  const handleRemoveEmployees = useCallback(async () => {
    if (selectedEmps.size === 0) return;
    try {
      setRemoveEmpLoading(true);
      // Remove from site by setting currentSite to null (not deleting from database)
      await Promise.all(
        Array.from(selectedEmps).map(async (id) => {
          const emp = siteEmployees.find(e => e.id === id);
          const isTeamLeaderOfSite = emp?.isTeamLeader && emp?.currentSite === viewSite?.name;
          const isSupervisorOfSite = emp?.isSupervisor && emp?.currentSite === viewSite?.name;
          await fetch(`/api/employees/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentSite: null,
              ...(isTeamLeaderOfSite ? { isTeamLeader: false, teamLeaderSiteId: null } : {}),
              ...(isSupervisorOfSite ? { isSupervisor: false, supervisorSiteId: null } : {}),
            }),
          });
        })
      );
      setShowRemoveEmpDialog(false);
      setSelectedEmps(new Set());
      if (viewSite) {
        fetchSiteEmployees(viewSite.name);
        fetchAllEmployees();
      }
      fetchSites();
      toast({ title: 'Removed', description: `${selectedEmps.size} employee(s) removed from site and set to idle.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to remove employees', variant: 'destructive' });
    } finally {
      setRemoveEmpLoading(false);
    }
  }, [selectedEmps, viewSite, siteEmployees, fetchSiteEmployees, fetchAllEmployees, fetchSites]);

  /* ── Add employee to site ── */
  const handleAddEmployee = useCallback(async (employee: AllEmployee) => {
    if (!viewSite) return;
    try {
      setAddingEmployee(true);
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSite: viewSite.name }),
      });
      const json = await res.json();
      if (json.success) {
        const transferred = employee.currentSite && employee.currentSite !== viewSite.name;
        toast({
          title: 'Employee Added',
          description: transferred
            ? `${employee.fullName} has been transferred from "${employee.currentSite}" to "${viewSite.name}"`
            : `${employee.fullName} has been added to "${viewSite.name}"`,
        });
        fetchSiteEmployees(viewSite.name);
        fetchAllEmployees();
        fetchSites();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to add employee', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to add employee', variant: 'destructive' });
    } finally {
      setAddingEmployee(false);
    }
  }, [viewSite, fetchSiteEmployees, fetchAllEmployees, fetchSites]);

  /* ── Assign Team Leader ── */
  const handleAssignTeamLeader = useCallback(async (emp: SiteEmployee, forceReplace = false) => {
    if (!viewSite) return;
    try {
      setAssignLoading(true);
      const body: Record<string, unknown> = {
        isTeamLeader: true,
        teamLeaderSiteId: viewSite.id,
      };
      if (forceReplace) {
        body.forceReplaceTeamLeader = true;
      }
      const res = await fetch(`/api/employees/${emp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 409 && json.existingLeader) {
        // Conflict: another team leader exists, show confirmation dialog
        setReplaceTLDialog({
          open: true,
          emp,
          existingTL: json.existingLeader,
        });
        return;
      }
      if (json.success) {
        toast({
          title: 'Team Leader Assigned',
          description: `${emp.fullName} has been assigned as Team Leader for ${viewSite.name}.`,
        });
        fetchSiteEmployees(viewSite.name);
        fetchAllEmployees();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to assign Team Leader', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to assign Team Leader', variant: 'destructive' });
    } finally {
      setAssignLoading(false);
    }
  }, [viewSite, fetchSiteEmployees, fetchAllEmployees]);

  /* ── Confirm Replace Team Leader ── */
  const handleConfirmReplaceTL = useCallback(async () => {
    const { emp } = replaceTLDialog;
    if (!emp || !viewSite) return;
    try {
      setAssignLoading(true);
      const res = await fetch(`/api/employees/${emp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTeamLeader: true,
          teamLeaderSiteId: viewSite.id,
          forceReplaceTeamLeader: true,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({
          title: 'Team Leader Replaced',
          description: `${emp.fullName} has been assigned as the new Team Leader for ${viewSite.name}.`,
        });
        fetchSiteEmployees(viewSite.name);
        fetchAllEmployees();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to replace Team Leader', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to replace Team Leader', variant: 'destructive' });
    } finally {
      setAssignLoading(false);
      setReplaceTLDialog({ open: false, emp: null, existingTL: null });
    }
  }, [replaceTLDialog, viewSite, fetchSiteEmployees, fetchAllEmployees]);

  /* ── Assign Supervisor ── */
  const handleAssignSupervisor = useCallback(async (emp: SiteEmployee, forceReplace = false) => {
    if (!viewSite) return;
    try {
      setAssignLoading(true);
      const body: Record<string, unknown> = {
        isSupervisor: true,
        supervisorSiteId: viewSite.id,
      };
      if (forceReplace) {
        body.forceReplaceSupervisor = true;
      }
      const res = await fetch(`/api/employees/${emp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 409 && json.existingSupervisor) {
        // Conflict: another supervisor exists, show confirmation dialog
        setReplaceSupervisorDialog({
          open: true,
          emp,
          existingSupervisor: json.existingSupervisor,
        });
        return;
      }
      if (json.success) {
        toast({
          title: 'Supervisor Assigned',
          description: `${emp.fullName} has been assigned as Supervisor for ${viewSite.name}.`,
        });
        fetchSiteEmployees(viewSite.name);
        fetchAllEmployees();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to assign Supervisor', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to assign Supervisor', variant: 'destructive' });
    } finally {
      setAssignLoading(false);
    }
  }, [viewSite, fetchSiteEmployees, fetchAllEmployees]);

  /* ── Confirm Replace Supervisor ── */
  const handleConfirmReplaceSupervisor = useCallback(async () => {
    const { emp } = replaceSupervisorDialog;
    if (!emp || !viewSite) return;
    try {
      setAssignLoading(true);
      const res = await fetch(`/api/employees/${emp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isSupervisor: true,
          supervisorSiteId: viewSite.id,
          forceReplaceSupervisor: true,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({
          title: 'Supervisor Replaced',
          description: `${emp.fullName} has been assigned as the new Supervisor for ${viewSite.name}.`,
        });
        fetchSiteEmployees(viewSite.name);
        fetchAllEmployees();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to replace Supervisor', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to replace Supervisor', variant: 'destructive' });
    } finally {
      setAssignLoading(false);
      setReplaceSupervisorDialog({ open: false, emp: null, existingSupervisor: null });
    }
  }, [replaceSupervisorDialog, viewSite, fetchSiteEmployees, fetchAllEmployees]);

  /* ── Toggle select ── */
  const toggleSelectEmp = useCallback((id: string) => {
    setSelectedEmps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ── Filter employees ── */
  const filteredEmployees = useMemo(() => {
    const filtered = siteEmployees.filter((e) => {
      if (!empSearch) return true;
      const q = empSearch.toLowerCase();
      return (
        e.fullName.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q) ||
        (e.position && e.position.toLowerCase().includes(q)) ||
        (e.trade && e.trade.toLowerCase().includes(q)) ||
        (e.nationality && e.nationality.toLowerCase().includes(q))
      );
    });
    // Sort: team leaders of the current site first, then supervisors, then rest
    const siteName = viewSite?.name;
    return filtered.sort((a, b) => {
      const aIsLeader = a.isTeamLeader && a.currentSite === siteName;
      const bIsLeader = b.isTeamLeader && b.currentSite === siteName;
      const aIsSupervisor = a.isSupervisor && a.currentSite === siteName;
      const bIsSupervisor = b.isSupervisor && b.currentSite === siteName;

      if (aIsLeader && !bIsLeader) return -1;
      if (!aIsLeader && bIsLeader) return 1;
      if (aIsSupervisor && !bIsSupervisor) return -1;
      if (!aIsSupervisor && bIsSupervisor) return 1;
      return 0;
    });
  }, [siteEmployees, empSearch, viewSite]);

  const toggleSelectAll = useCallback(() => {
    if (selectedEmps.size === filteredEmployees.length) {
      setSelectedEmps(new Set());
    } else {
      setSelectedEmps(new Set(filteredEmployees.map((e) => e.id)));
    }
  }, [selectedEmps, filteredEmployees]);

  const currentSiteEmployeeIds = useMemo(() => {
    return new Set(siteEmployees.map((e) => e.id));
  }, [siteEmployees]);

  // Attendance sheet employees (fetched separately for direct attendance access)
  const [attendanceEmployees, setAttendanceEmployees] = useState<SiteEmployee[]>([]);
  const [loadingAttendanceEmps, setLoadingAttendanceEmps] = useState(false);

  /* ── Attendance sheet handler ── */
  const handleAttendanceSheet = useCallback(async (site: Site) => {
    setAttendanceSite(site);
    // Fetch employees for this site
    setLoadingAttendanceEmps(true);
    try {
      const res = await fetch('/api/employees?limit=1000&status=all');
      const json = await res.json();
      if (json.success) {
        const emps = (json.data.employees || []).filter(
          (e: SiteEmployee) => e.currentSite === site.name && e.status !== 'deleted'
        );
        setAttendanceEmployees(emps);
      }
    } catch {
      setAttendanceEmployees([]);
    } finally {
      setLoadingAttendanceEmps(false);
    }
  }, []);

  // Current site's team leader and supervisor
  const currentTeamLeader = useMemo(() => {
    if (!viewSite) return null;
    return siteEmployees.find((e) => e.isTeamLeader && e.currentSite === viewSite.name) || null;
  }, [siteEmployees, viewSite]);

  const currentSupervisor = useMemo(() => {
    if (!viewSite) return null;
    return siteEmployees.find((e) => e.isSupervisor && e.currentSite === viewSite.name) || null;
  }, [siteEmployees, viewSite]);

  // If attendance sheet is open, render it
  if (attendanceSite) {
    if (loadingAttendanceEmps) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <span className="ml-3 text-slate-400">Loading attendance data...</span>
        </div>
      );
    }
    return (
      <AttendanceSheet
        site={attendanceSite}
        employees={attendanceEmployees}
        onClose={() => {
          setAttendanceSite(null);
          setAttendanceEmployees([]);
        }}
      />
    );
  }

  /* ───────── RENDER ───────── */
  return (
    <div className="flex flex-col gap-6">
      {/* Sites List View */}
      {subView === 'list' && (
        <div className="flex flex-col gap-6">
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white">Sites</h2>
              <p className="text-slate-400 mt-1">
                Manage work sites and view employees assigned to each site.
              </p>
            </div>
            <Button onClick={() => setShowAddDialog(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
              <Plus className="h-4 w-4" />
              Add Site
            </Button>
          </div>

          {/* Tabs: Active / Inactive */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="bg-slate-800 border border-slate-700">
              <TabsTrigger value="active" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white gap-1.5">
                <Power className="h-3.5 w-3.5" />
                Active
                <Badge variant="secondary" className="ml-1 bg-slate-700 text-slate-300 text-[10px] px-1.5 py-0 h-4 min-w-[20px] flex items-center justify-center">
                  {activeSites.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="inactive" className="data-[state=active]:bg-slate-600 data-[state=active]:text-white gap-1.5">
                <PowerOff className="h-3.5 w-3.5" />
                Inactive
                <Badge variant="secondary" className="ml-1 bg-slate-700 text-slate-300 text-[10px] px-1.5 py-0 h-4 min-w-[20px] flex items-center justify-center">
                  {inactiveSites.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            {/* Search - shared between tabs */}
            <div className="relative max-w-sm mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search sites..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-emerald-500/20 focus:border-emerald-500/50"
              />
            </div>

            <TabsContent value="active" className="mt-4">
              <SiteCardsGrid
                sites={activeSites}
                search={search}
                loading={loading}
                onSearchChange={setSearch}
                onViewEmployees={handleViewEmployees}
                onDeleteSite={setDeleteSiteTarget}
                onEditSite={(site) => {
                  setEditSiteTarget(site);
                  setEditSiteName(site.name);
                  setEditSiteClientName(site.clientName || '');
                  setEditSiteProjectName(site.projectName || '');
                  setEditSiteProjectId(site.projectId || '');
                }}
                onToggleActive={handleToggleActive}
                onAttendanceSheet={handleAttendanceSheet}
              />
            </TabsContent>

            <TabsContent value="inactive" className="mt-4">
              <SiteCardsGrid
                sites={inactiveSites}
                search={search}
                loading={loading}
                onSearchChange={setSearch}
                onViewEmployees={handleViewEmployees}
                onDeleteSite={setDeleteSiteTarget}
                onEditSite={(site) => {
                  setEditSiteTarget(site);
                  setEditSiteName(site.name);
                  setEditSiteClientName(site.clientName || '');
                  setEditSiteProjectName(site.projectName || '');
                  setEditSiteProjectId(site.projectId || '');
                }}
                onToggleActive={handleToggleActive}
                onAttendanceSheet={handleAttendanceSheet}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Employee Full Page View */}
      {subView === 'employees' && viewSite && (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBackToList}
                className="h-9 w-9 text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-emerald-400" />
                  <h2 className="text-xl font-bold text-white">{viewSite.name}</h2>
                  <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                    {siteEmployees.length} {siteEmployees.length === 1 ? 'employee' : 'employees'}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
                  {currentTeamLeader ? (
                    <div className="flex items-center gap-1.5">
                      <Crown className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-sm text-amber-400 font-medium">Team Leader: {currentTeamLeader.fullName}</span>
                    </div>
                  ) : null}
                  {currentSupervisor ? (
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
                      <span className="text-sm text-violet-400 font-medium">Supervisor: {currentSupervisor.fullName}</span>
                    </div>
                  ) : null}
                  {!currentTeamLeader && !currentSupervisor && (
                    <p className="text-sm text-slate-500">
                      Created {new Date(viewSite.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AddEmployeeCombobox
                allEmployees={allEmployees}
                currentSiteName={viewSite.name}
                currentSiteEmployeeIds={currentSiteEmployeeIds}
                onAdd={handleAddEmployee}
                loading={addingEmployee || loadingAllEmployees}
              />
              {selectedEmps.size > 0 && (
                <Button
                  variant="destructive"
                  className="gap-2"
                  onClick={() => setShowRemoveEmpDialog(true)}
                >
                  <UserMinus className="h-4 w-4" />
                  Remove ({selectedEmps.size})
                </Button>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search employees..."
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
              className="pl-10 bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-emerald-500/20 focus:border-emerald-500/50"
            />
          </div>

          <Separator className="bg-slate-700/50" />

          {/* Employee Table */}
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-0">
              {loadingEmployees ? (
                <div className="space-y-3 p-6">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-14 w-full bg-slate-700/50" />
                  ))}
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Users className="h-10 w-10 text-slate-600 mb-3" />
                  <p className="text-sm text-slate-400">
                    {empSearch ? 'No employees match your search.' : 'No employees assigned to this site yet.'}
                  </p>
                  {!empSearch && (
                    <p className="text-xs text-slate-500 mt-1">
                      Click &quot;Add Employee&quot; to assign employees.
                    </p>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700 hover:bg-transparent">
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selectedEmps.size === filteredEmployees.length && filteredEmployees.length > 0}
                            onCheckedChange={toggleSelectAll}
                            className="border-slate-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                          />
                        </TableHead>
                        <TableHead className="text-slate-400 font-semibold">Employee</TableHead>
                        <TableHead className="text-slate-400 font-semibold">ID</TableHead>
                        <TableHead className="text-slate-400 font-semibold">Trade</TableHead>
                        <TableHead className="text-slate-400 font-semibold">Rating</TableHead>
                        <TableHead className="text-slate-400 font-semibold text-center">Status</TableHead>
                        <TableHead className="text-slate-400 font-semibold w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEmployees.map((emp) => {
                        const isTL = emp.isTeamLeader && emp.currentSite === viewSite.name;
                        const isSupervisor = emp.isSupervisor && emp.currentSite === viewSite.name;

                        return (
                          <TableRow
                            key={emp.id}
                            className={cn(
                              "border-slate-700/50 hover:bg-slate-700/30",
                              isTL && "bg-amber-500/[0.03]",
                              !isTL && isSupervisor && "bg-violet-500/[0.03]"
                            )}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedEmps.has(emp.id)}
                                onCheckedChange={() => toggleSelectEmp(emp.id)}
                                className="border-slate-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                {emp.photo ? (
                                  <img
                                    src={emp.photo}
                                    alt={emp.fullName}
                                    className="h-8 w-8 rounded-full object-cover border border-slate-600"
                                  />
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-medium text-slate-300 border border-slate-600">
                                    {emp.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-sm font-medium text-white truncate">{emp.fullName}</p>
                                    {isTL && (
                                      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] px-1.5 py-0 shrink-0 gap-0.5">
                                        <Crown className="h-2.5 w-2.5" /> Team Leader
                                      </Badge>
                                    )}
                                    {isSupervisor && (
                                      <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/25 text-[10px] px-1.5 py-0 shrink-0 gap-0.5">
                                        <ShieldCheck className="h-2.5 w-2.5" /> Supervisor
                                      </Badge>
                                    )}
                                  </div>
                                  {emp.nationality && (
                                    <p className="text-xs text-slate-500">{emp.nationality}</p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-300 text-sm font-mono">{emp.employeeId}</TableCell>
                            <TableCell className="text-slate-300 text-sm">
                              {emp.trade || emp.position || <span className="text-slate-600">&mdash;</span>}
                            </TableCell>
                            <TableCell>
                              <StarRating rating={emp.rating} />
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                className={`text-xs ${
                                  emp.status === 'active'
                                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                    : emp.status === 'pending_deletion'
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                    : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                                }`}
                              >
                                {emp.status === 'pending_deletion' ? 'Pending' : emp.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-slate-500 hover:text-white hover:bg-slate-700"
                                    disabled={assignLoading}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="bg-slate-800 border-slate-700" align="end">
                                  <DropdownMenuLabel className="text-slate-400 text-xs">
                                    Assign Role
                                  </DropdownMenuLabel>
                                  {!isTL && (
                                    <DropdownMenuItem
                                      className="text-amber-400 focus:text-amber-300 focus:bg-amber-500/10 cursor-pointer"
                                      onClick={() => handleAssignTeamLeader(emp)}
                                      disabled={assignLoading}
                                    >
                                      <Crown className="h-4 w-4" />
                                      Assign as Team Leader
                                    </DropdownMenuItem>
                                  )}
                                  {!isSupervisor && (
                                    <DropdownMenuItem
                                      className="text-violet-400 focus:text-violet-300 focus:bg-violet-500/10 cursor-pointer"
                                      onClick={() => handleAssignSupervisor(emp)}
                                      disabled={assignLoading}
                                    >
                                      <ShieldCheck className="h-4 w-4" />
                                      Assign as Supervisor
                                    </DropdownMenuItem>
                                  )}
                                  {isTL && isSupervisor && (
                                    <DropdownMenuItem disabled className="text-slate-500">
                                      Already assigned both roles
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add Site Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <DialogHeader>
            <DialogTitle>Add New Site</DialogTitle>
            <DialogDescription className="text-slate-400">
              Enter details for the new work site.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Site Name *</Label>
              <Input
                placeholder="e.g. NPC-Umm Al Quwain"
                value={addSiteName}
                onChange={(e) => setAddSiteName(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 focus:ring-emerald-500/20 focus:border-emerald-500/50"
                onKeyDown={(e) => e.key === 'Enter' && handleAddSite()}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Client Name</Label>
              <ClientCombobox
                clients={availableClients}
                value={addSiteClientName}
                onChange={setAddSiteClientName}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Project Name</Label>
              <Input
                placeholder="e.g. NPC-Umm Al Quwain"
                value={addSiteProjectName}
                onChange={(e) => setAddSiteProjectName(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 focus:ring-emerald-500/20 focus:border-emerald-500/50"
                onKeyDown={(e) => e.key === 'Enter' && handleAddSite()}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Project ID</Label>
              <Input
                placeholder="e.g. PRJ-001"
                value={addSiteProjectId}
                onChange={(e) => setAddSiteProjectId(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 focus:ring-emerald-500/20 focus:border-emerald-500/50 font-mono"
                onKeyDown={(e) => e.key === 'Enter' && handleAddSite()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowAddDialog(false); setAddSiteName(''); setAddSiteClientName(''); setAddSiteProjectName(''); setAddSiteProjectId(''); }} className="text-slate-400 hover:text-white">
              Cancel
            </Button>
            <Button
              onClick={handleAddSite}
              disabled={!addSiteName.trim() || addLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {addLoading ? 'Adding...' : 'Add Site'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Site Dialog */}
      <Dialog
        open={!!editSiteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setEditSiteTarget(null);
            setEditSiteName('');
            setEditSiteClientName('');
            setEditSiteProjectName('');
            setEditSiteProjectId('');
          }
        }}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <DialogHeader>
            <DialogTitle>Edit Site</DialogTitle>
            <DialogDescription className="text-slate-400">
              Update details for &ldquo;{editSiteTarget?.name}&rdquo;. All employees assigned to this site will be updated if the name changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Site Name *</Label>
              <Input
                placeholder="Site name"
                value={editSiteName}
                onChange={(e) => setEditSiteName(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 focus:ring-emerald-500/20 focus:border-emerald-500/50"
                onKeyDown={(e) => e.key === 'Enter' && handleEditSite()}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Client Name</Label>
              <ClientCombobox
                clients={availableClients}
                value={editSiteClientName}
                onChange={setEditSiteClientName}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Project Name</Label>
              <Input
                placeholder="Project name"
                value={editSiteProjectName}
                onChange={(e) => setEditSiteProjectName(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 focus:ring-emerald-500/20 focus:border-emerald-500/50"
                onKeyDown={(e) => e.key === 'Enter' && handleEditSite()}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Project ID</Label>
              <Input
                placeholder="e.g. PRJ-001"
                value={editSiteProjectId}
                onChange={(e) => setEditSiteProjectId(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 focus:ring-emerald-500/20 focus:border-emerald-500/50 font-mono"
                onKeyDown={(e) => e.key === 'Enter' && handleEditSite()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setEditSiteTarget(null);
                setEditSiteName('');
                setEditSiteClientName('');
                setEditSiteProjectName('');
                setEditSiteProjectId('');
              }}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditSite}
              disabled={!editSiteName.trim() || (editSiteName === editSiteTarget?.name && editSiteClientName === (editSiteTarget?.clientName || '') && editSiteProjectName === (editSiteTarget?.projectName || '') && editSiteProjectId === (editSiteTarget?.projectId || '')) || editLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {editLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Site Confirmation */}
      <Dialog open={!!deleteSiteTarget} onOpenChange={(open) => !open && setDeleteSiteTarget(null)}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Site</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="text-white font-semibold">{deleteSiteTarget?.name}</span>?
              All employees assigned to this site will be unassigned, but they won&apos;t be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteSiteTarget(null)}
              className="bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteSite} disabled={deleteLoading}>
              {deleteLoading ? 'Deleting...' : 'Delete Site'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Selected Employees Confirmation */}
      <Dialog open={showRemoveEmpDialog} onOpenChange={setShowRemoveEmpDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Remove {selectedEmps.size} {selectedEmps.size === 1 ? 'Employee' : 'Employees'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to remove {selectedEmps.size}{' '}
              {selectedEmps.size === 1 ? 'employee' : 'employees'} from this site? They will be removed from the site and set to idle status. They will not be deleted from the database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRemoveEmpDialog(false)}
              className="bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveEmployees} disabled={removeEmpLoading}>
              {removeEmpLoading ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace Team Leader Confirmation */}
      <AlertDialog
        open={replaceTLDialog.open}
        onOpenChange={(open) => {
          if (!open) setReplaceTLDialog({ open: false, emp: null, existingTL: null });
        }}
      >
        <AlertDialogContent className="bg-slate-800 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Replace Team Leader?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              A Team Leader already exists for this site: <span className="text-amber-400 font-semibold">{replaceTLDialog.existingTL?.fullName}</span>.
              Do you want to replace the current Team Leader with <span className="text-white font-semibold">{replaceTLDialog.emp?.fullName}</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReplaceTL}
              disabled={assignLoading}
              className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
            >
              {assignLoading ? 'Replacing...' : 'Replace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replace Supervisor Confirmation */}
      <AlertDialog
        open={replaceSupervisorDialog.open}
        onOpenChange={(open) => {
          if (!open) setReplaceSupervisorDialog({ open: false, emp: null, existingSupervisor: null });
        }}
      >
        <AlertDialogContent className="bg-slate-800 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Replace Supervisor?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              A Supervisor already exists for this site: <span className="text-violet-400 font-semibold">{replaceSupervisorDialog.existingSupervisor?.fullName}</span>.
              Do you want to replace the current Supervisor with <span className="text-white font-semibold">{replaceSupervisorDialog.emp?.fullName}</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReplaceSupervisor}
              disabled={assignLoading}
              className="bg-violet-600 hover:bg-violet-700 text-white border-violet-600"
            >
              {assignLoading ? 'Replacing...' : 'Replace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
