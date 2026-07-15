'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Shirt,
  Search,
  Plus,
  Eye,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  Loader2,
  AlertTriangle,
  User,
  Building2,
  Shield,
  FileText,
  Calendar,
  Check,
  RotateCcw,
  Package,
  Minus,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { UniformEntryDetails } from './uniform-entry-details';

/* ───────── Types ───────── */

interface UniformEntry {
  id: string;
  uniformId: number;
  tokenNumber: number;
  employeeName: string;
  employeeId: string;
  documentType: string;
  documentNumber: string;
  items: string; // JSON string
  siteName: string | null;
  teamLeaderName: string | null;
  isRenewal: boolean;
  previousTokenId: string | null;
  createdAt: string;
  renewalDate: string;
  employee?: {
    id: string;
    fullName: string;
    employeeId: string;
    isTeamLeader: boolean;
    currentSite: string | null;
  };
}

interface Employee {
  id: string;
  fullName: string;
  employeeId: string;
  nationality: string | null;
  currentSite: string | null;
  status: string;
  position: string | null;
  passportNumber: string | null;
  idNumber: string | null;
  isTeamLeader: boolean;
  teamLeaderSiteId: string | null;
}

interface Site {
  id: string;
  name: string;
}

interface ItemsMap {
  uniform: boolean;
  shoes: boolean;
  helmet: boolean;
  bottle: boolean;
  safetyJacket: boolean;
  mattress: boolean;
  pillow: boolean;
}

const DEFAULT_ITEMS: ItemsMap = {
  uniform: false,
  shoes: false,
  helmet: false,
  bottle: false,
  safetyJacket: false,
  mattress: false,
  pillow: false,
};

const ITEM_LABELS: Record<keyof ItemsMap, string> = {
  uniform: 'Uniform',
  shoes: 'Shoes',
  helmet: 'Helmet',
  bottle: 'Bottle',
  safetyJacket: 'Safety Jacket',
  mattress: 'Mattress',
  pillow: 'Pillow',
};

const ITEM_ICONS: Record<keyof ItemsMap, string> = {
  uniform: '👕',
  shoes: '👟',
  helmet: '🪖',
  bottle: '🧴',
  safetyJacket: '🦺',
  mattress: '🛏️',
  pillow: '🛋️',
};

/* ───────── Helpers ───────── */

/**
 * Normalize an item name for matching: lowercase + strip everything that
 * isn't a letter or digit. This lets us match stock entries the user typed
 * (e.g. "Uniform", "Safety Jacket", "safety jacket") against the camelCase
 * keys in DEFAULT_ITEMS ("uniform", "safetyJacket") and against ITEM_LABELS.
 */
function normalizeItemName(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Returns true if a stock item (by its free-form itemName) corresponds to the
 * given DEFAULT_ITEMS key. Matches against both the raw key and its display
 * label, so "Uniform" / "uniform" / "UNIFORM" all map to the `uniform` key,
 * and "Safety Jacket" / "safety jacket" / "safetyJacket" map to `safetyJacket`.
 */
function stockMatchesKey(stockItemName: string, key: string): boolean {
  const normStock = normalizeItemName(stockItemName);
  if (!normStock) return false;
  if (normStock === normalizeItemName(key)) return true;
  if (normStock === normalizeItemName(ITEM_LABELS[key as keyof ItemsMap])) return true;
  return false;
}

function parseItems(itemsStr: string): ItemsMap {
  try {
    const parsed = JSON.parse(itemsStr);
    return {
      uniform: !!parsed.uniform,
      shoes: !!parsed.shoes,
      helmet: !!parsed.helmet,
      bottle: !!parsed.bottle,
      safetyJacket: !!parsed.safetyJacket,
      mattress: !!parsed.mattress,
      pillow: !!parsed.pillow,
    };
  } catch {
    return { ...DEFAULT_ITEMS };
  }
}

function getActiveItems(itemsStr: string): string[] {
  const items = parseItems(itemsStr);
  return (Object.keys(items) as (keyof ItemsMap)[]).filter((k) => items[k]);
}

function getRenewalStatus(renewalDate: string): {
  label: string;
  variant: 'green' | 'amber' | 'slate';
  daysRemaining?: number;
} {
  const now = new Date();
  const renewal = new Date(renewalDate);
  const diffMs = renewal.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return { label: 'Renewal Available', variant: 'green' };
  }
  if (diffDays <= 30) {
    return { label: `${diffDays} day${diffDays === 1 ? '' : 's'} remaining`, variant: 'amber', daysRemaining: diffDays };
  }
  return { label: 'Active', variant: 'slate', daysRemaining: diffDays };
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/* ───────── Searchable Employee Dropdown ───────── */

function EmployeeCombobox({
  employees,
  selectedEmployee,
  onSelect,
  loading,
}: {
  employees: Employee[];
  selectedEmployee: Employee | null;
  onSelect: (emp: Employee) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return employees;
    const q = filter.toLowerCase();
    return employees.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q)
    );
  }, [employees, filter]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={loading}
          className="w-full justify-start bg-slate-900 border-slate-600 text-white hover:bg-slate-800 hover:text-white font-normal"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <User className="h-4 w-4 mr-2 text-slate-400" />
          )}
          {selectedEmployee ? (
            <span className="truncate">
              {selectedEmployee.fullName}{' '}
              <span className="text-slate-500 text-xs">({selectedEmployee.employeeId})</span>
            </span>
          ) : (
            <span className="text-slate-500">Search employee...</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-slate-800 border-slate-600" align="start">
        <Command className="bg-slate-800">
          <CommandInput
            placeholder="Search by name or ID..."
            value={filter}
            onValueChange={setFilter}
            className="text-white"
          />
          <CommandList className="max-h-64">
            <CommandEmpty className="text-slate-400 py-4 text-center text-sm">
              No employees found.
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((emp) => (
                <CommandItem
                  key={emp.id}
                  value={`${emp.fullName} ${emp.employeeId}`}
                  onSelect={() => {
                    onSelect(emp);
                    setOpen(false);
                    setFilter('');
                  }}
                  className="text-slate-200 data-[selected=true]:bg-slate-700 data-[selected=true]:text-white py-2.5"
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate">{emp.fullName}</span>
                      {emp.isTeamLeader && (
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0 shrink-0">
                          <Shield className="h-2.5 w-2.5 mr-0.5" />
                          Leader
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {emp.employeeId}
                      {emp.currentSite ? ` · ${emp.currentSite}` : ''}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ───────── Searchable Site Dropdown ───────── */

function SiteCombobox({
  sites,
  selectedSite,
  onSelect,
  loading,
}: {
  sites: Site[];
  selectedSite: Site | null;
  onSelect: (site: Site) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return sites;
    const q = filter.toLowerCase();
    return sites.filter((s) => s.name.toLowerCase().includes(q));
  }, [sites, filter]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={loading}
          className="w-full justify-start bg-slate-900 border-slate-600 text-white hover:bg-slate-800 hover:text-white font-normal"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Building2 className="h-4 w-4 mr-2 text-slate-400" />
          )}
          {selectedSite ? (
            <span className="truncate">{selectedSite.name}</span>
          ) : (
            <span className="text-slate-500">Select site...</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 bg-slate-800 border-slate-600" align="start">
        <Command className="bg-slate-800">
          <CommandInput
            placeholder="Search sites..."
            value={filter}
            onValueChange={setFilter}
            className="text-white"
          />
          <CommandList className="max-h-64">
            <CommandEmpty className="text-slate-400 py-4 text-center text-sm">
              No sites found.
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((site) => (
                <CommandItem
                  key={site.id}
                  value={site.name}
                  onSelect={() => {
                    onSelect(site);
                    setOpen(false);
                    setFilter('');
                  }}
                  className="text-slate-200 data-[selected=true]:bg-slate-700 data-[selected=true]:text-white py-2.5"
                >
                  <Building2 className="h-4 w-4 mr-2 text-slate-400 shrink-0" />
                  <span className="text-sm truncate">{site.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ───────── Searchable Team Leader Dropdown ───────── */

function TeamLeaderCombobox({
  siteEmployees,
  currentTeamLeader,
  isChangingTeamLeader,
  selectedSite,
  teamLeaderLoading,
  isSettingTeamLeader,
  onSelectEmployee,
  onChangeLeaderClick,
}: {
  siteEmployees: Employee[];
  currentTeamLeader: Employee | null;
  isChangingTeamLeader: boolean;
  selectedSite: Site | null;
  teamLeaderLoading: boolean;
  isSettingTeamLeader: boolean;
  onSelectEmployee: (emp: Employee) => void;
  onChangeLeaderClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return siteEmployees;
    const q = filter.toLowerCase();
    return siteEmployees.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q)
    );
  }, [siteEmployees, filter]);

  // No site selected
  if (!selectedSite) {
    return (
      <Button
        variant="outline"
        disabled
        className="w-full justify-start bg-slate-900 border-slate-600 text-slate-500 font-normal"
      >
        <Shield className="h-4 w-4 mr-2 text-slate-500" />
        Select a site first...
      </Button>
    );
  }

  // Loading
  if (teamLeaderLoading || isSettingTeamLeader) {
    return (
      <Button
        variant="outline"
        disabled
        className="w-full justify-start bg-slate-900 border-slate-600 text-white font-normal"
      >
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        {isSettingTeamLeader ? 'Setting team leader...' : 'Loading...'}
      </Button>
    );
  }

  // If team leader exists and we're NOT in change mode, show leader + "Change" option
  if (currentTeamLeader && !isChangingTeamLeader) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start bg-slate-900 border-slate-600 text-white hover:bg-slate-800 hover:text-white font-normal"
          >
            <Shield className="h-4 w-4 mr-2 text-blue-400" />
            <span className="truncate">
              {currentTeamLeader.fullName}{' '}
              <span className="text-slate-500 text-xs">({currentTeamLeader.employeeId})</span>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0 bg-slate-800 border-slate-600" align="start">
          <Command className="bg-slate-800">
            <CommandList className="max-h-64">
              <CommandGroup>
                {/* Current team leader */}
                <CommandItem
                  value={currentTeamLeader.fullName}
                  className="text-slate-200 data-[selected=true]:bg-slate-700 data-[selected=true]:text-white py-2.5"
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5 text-blue-400" />
                      <span className="text-sm truncate">{currentTeamLeader.fullName}</span>
                      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0 shrink-0">
                        Leader
                      </Badge>
                    </div>
                    <span className="text-[11px] text-slate-500 ml-5.5">
                      {currentTeamLeader.employeeId}
                    </span>
                  </div>
                </CommandItem>

                <Separator className="bg-slate-700/50 my-1" />

                {/* Change team leader option */}
                <CommandItem
                  value="change-team-leader"
                  onSelect={() => {
                    onChangeLeaderClick();
                    setOpen(false);
                  }}
                  className="text-amber-400 data-[selected=true]:bg-amber-500/10 data-[selected=true]:text-amber-300 py-2.5"
                >
                  <RefreshCw className="h-4 w-4 mr-2 shrink-0" />
                  <span className="text-sm">Change Team Leader...</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  // No team leader OR in change mode → show all site employees
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start bg-slate-900 border-slate-600 text-white hover:bg-slate-800 hover:text-white font-normal"
        >
          <Shield className="h-4 w-4 mr-2 text-slate-400" />
          {isChangingTeamLeader ? (
            <span className="text-amber-400">Select new team leader...</span>
          ) : (
            <span className="text-slate-500">Select team leader...</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-slate-800 border-slate-600" align="start">
        <Command className="bg-slate-800">
          <CommandInput
            placeholder="Search by name or ID..."
            value={filter}
            onValueChange={setFilter}
            className="text-white"
          />
          <CommandList className="max-h-64">
            <CommandEmpty className="text-slate-400 py-4 text-center text-sm">
              No employees found for this site.
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((emp) => (
                <CommandItem
                  key={emp.id}
                  value={`${emp.fullName} ${emp.employeeId}`}
                  onSelect={() => {
                    onSelectEmployee(emp);
                    setOpen(false);
                    setFilter('');
                  }}
                  className="text-slate-200 data-[selected=true]:bg-slate-700 data-[selected=true]:text-white py-2.5"
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate">{emp.fullName}</span>
                      {emp.isTeamLeader && (
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0 shrink-0">
                          <Shield className="h-2.5 w-2.5 mr-0.5" />
                          Leader
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {emp.employeeId}
                      {emp.position ? ` · ${emp.position}` : ''}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ───────── Renewal Status Badge ───────── */

function RenewalStatusBadge({ renewalDate }: { renewalDate: string }) {
  const status = getRenewalStatus(renewalDate);

  if (status.variant === 'green') {
    return (
      <Badge className="bg-green-500/15 text-green-400 border-green-500/25 hover:bg-green-500/20 gap-1">
        <RefreshCw className="h-3 w-3" />
        {status.label}
      </Badge>
    );
  }
  if (status.variant === 'amber') {
    return (
      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/20">
        {status.label}
      </Badge>
    );
  }
  return (
    <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/25">
      {status.label}
    </Badge>
  );
}

/* ───────── Item Badges ───────── */

function ItemBadges({ itemsStr }: { itemsStr: string }) {
  const activeItems = getActiveItems(itemsStr);
  if (activeItems.length === 0) {
    return <span className="text-slate-500 text-xs">None</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {activeItems.map((key) => (
        <Badge
          key={key}
          className="bg-blue-500/15 text-blue-400 border-blue-500/25 text-[11px] px-1.5 py-0"
        >
          {ITEM_ICONS[key as keyof ItemsMap]} {ITEM_LABELS[key as keyof ItemsMap]}
        </Badge>
      ))}
    </div>
  );
}

/* ───────── Loading Skeleton ───────── */

function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-5 w-12 bg-slate-700" />
          <Skeleton className="h-5 w-32 bg-slate-700" />
          <Skeleton className="h-5 w-20 bg-slate-700" />
          <div className="flex-1 flex gap-1">
            <Skeleton className="h-5 w-16 bg-slate-700" />
            <Skeleton className="h-5 w-16 bg-slate-700" />
          </div>
          <Skeleton className="h-5 w-20 bg-slate-700" />
          <Skeleton className="h-5 w-24 bg-slate-700" />
        </div>
      ))}
    </div>
  );
}

/* ───────── Main Component ───────── */

export function UniformRegistryPage() {
  // Tab state: 'tokens' or 'stock'
  const [activeTab, setActiveTab] = useState<'tokens' | 'stock'>('tokens');

  // List state
  const [entries, setEntries] = useState<UniformEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState<string>('all');
  const [sites, setSites] = useState<Site[]>([]);

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create form state
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [documentType, setDocumentType] = useState<string>('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [items, setItems] = useState<ItemsMap>({ ...DEFAULT_ITEMS });
  const [itemSizes, setItemSizes] = useState<Record<string, string>>({}); // e.g. { uniform: "L", shoes: "42" }
  const [stockItems, setStockItems] = useState<Array<{ id: string; itemName: string; size: string | null; quantity: number }>>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [teamLeaderName, setTeamLeaderName] = useState<string | null>(null);
  const [teamLeaderLoading, setTeamLeaderLoading] = useState(false);
  const [currentTeamLeader, setCurrentTeamLeader] = useState<Employee | null>(null);
  const [siteEmployees, setSiteEmployees] = useState<Employee[]>([]);
  const [isChangingTeamLeader, setIsChangingTeamLeader] = useState(false);
  const [changeLeaderConfirmOpen, setChangeLeaderConfirmOpen] = useState(false);
  const [isSettingTeamLeader, setIsSettingTeamLeader] = useState(false);

  // Employee/site data for dropdowns
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  // Renewal state
  const [isRenewal, setIsRenewal] = useState(false);
  const [previousTokenId, setPreviousTokenId] = useState<string | null>(null);

  // View details dialog
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<UniformEntry | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Full-page entry details view
  const [viewingEntryDetails, setViewingEntryDetails] = useState<UniformEntry | null>(null);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState<UniformEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Fetch entries ── */
  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '10',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (siteFilter && siteFilter !== 'all') params.set('siteName', siteFilter);

      const res = await fetch(`/api/uniform-registry?${params}`);
      const json = await res.json();
      if (json.success && json.data) {
        setEntries(json.data.entries || []);
        setTotal(json.data.total);
        setTotalPages(json.data.totalPages);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch uniform registry entries', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, siteFilter]);

  /* ── Fetch sites ── */
  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch('/api/sites');
      const json = await res.json();
      if (json.success) {
        setSites(json.data.sites || []);
      }
    } catch {
      // silent
    }
  }, []);

  /* ── Fetch employees for dropdown ── */
  const fetchEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const res = await fetch('/api/employees?limit=1000&status=active');
      const json = await res.json();
      if (json.success) {
        setEmployees(json.data.employees || []);
      }
    } catch {
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  /* ── Find team leader for a site ── */
  const findTeamLeaderForSite = useCallback(async (siteId: string) => {
    setTeamLeaderLoading(true);
    setTeamLeaderName(null);
    setCurrentTeamLeader(null);
    setIsChangingTeamLeader(false);
    try {
      // Find the site name from the sites list
      const site = sites.find((s) => s.id === siteId);
      if (!site) {
        setTeamLeaderName(null);
        setSiteEmployees([]);
        return null;
      }

      // Search employees who are team leaders of this site
      const res = await fetch(`/api/employees?limit=1000&status=active`);
      const json = await res.json();
      if (json.success) {
        const allEmps: Employee[] = json.data.employees || [];
        // Filter employees of this site
        const siteEmps = allEmps.filter(
          (e: Employee) => e.currentSite === site.name && e.status === 'active'
        );
        setSiteEmployees(siteEmps);

        const leader = allEmps.find(
          (e: Employee) => e.isTeamLeader && e.teamLeaderSiteId === siteId
        );
        if (leader) {
          setTeamLeaderName(leader.fullName);
          setCurrentTeamLeader(leader);
          return leader;
        } else {
          setTeamLeaderName(null);
          setCurrentTeamLeader(null);
          return null;
        }
      }
      setSiteEmployees([]);
      return null;
    } catch {
      setTeamLeaderName(null);
      setCurrentTeamLeader(null);
      setSiteEmployees([]);
      return null;
    } finally {
      setTeamLeaderLoading(false);
    }
  }, [sites]);

  /* ── Effects ── */
  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  // Debounce search
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  // Reset page on site filter change
  useEffect(() => {
    setPage(1);
  }, [siteFilter]);

  /* ── Open Create Dialog ── */
  const openCreateDialog = useCallback(() => {
    setSelectedEmployee(null);
    setDocumentType('');
    setDocumentNumber('');
    setItems({ ...DEFAULT_ITEMS });
    setItemSizes({});
    setSelectedSite(null);
    setTeamLeaderName(null);
    setCurrentTeamLeader(null);
    setSiteEmployees([]);
    setIsChangingTeamLeader(false);
    setIsRenewal(false);
    setPreviousTokenId(null);
    setCreateDialogOpen(true);
    fetchEmployees();
    // Fetch stock items so we know which sizes are available
    fetch('/api/stock').then(res => res.json()).then(data => {
      if (data.success) setStockItems(data.data.stockItems || []);
    }).catch(() => {});
  }, [fetchEmployees]);

  /* ── Open Renew Dialog ── */
  const openRenewDialog = useCallback((entry: UniformEntry) => {
    const parsedItems = parseItems(entry.items);
    const emp: Employee = {
      id: entry.employeeId,
      fullName: entry.employeeName,
      employeeId: '',
      nationality: null,
      currentSite: entry.siteName,
      status: 'active',
      position: null,
      passportNumber: null,
      idNumber: null,
      isTeamLeader: false,
      teamLeaderSiteId: null,
    };

    setSelectedEmployee(emp);
    setDocumentType(entry.documentType);
    setDocumentNumber(entry.documentNumber);
    setItems(parsedItems);
    setIsRenewal(true);
    setPreviousTokenId(entry.id);
    setCurrentTeamLeader(null);
    setSiteEmployees([]);
    setIsChangingTeamLeader(false);

    // Try to find the site from the sites list
    const site = sites.find((s) => s.name === entry.siteName) || null;
    setSelectedSite(site);

    if (site) {
      findTeamLeaderForSite(site.id);
    } else {
      setTeamLeaderName(entry.teamLeaderName);
    }

    setCreateDialogOpen(true);
    fetchEmployees();
    // Fetch stock items so size dropdowns are populated when renewing too.
    fetch('/api/stock').then(res => res.json()).then(data => {
      if (data.success) setStockItems(data.data.stockItems || []);
    }).catch(() => {});
  }, [sites, findTeamLeaderForSite, fetchEmployees]);

  /* ── Handle Employee Selection ── */
  const handleEmployeeSelect = useCallback((emp: Employee) => {
    setSelectedEmployee(emp);

    // Auto-fill document info
    if (emp.passportNumber && !emp.idNumber) {
      setDocumentType('passport');
      setDocumentNumber(emp.passportNumber);
    } else if (emp.idNumber && !emp.passportNumber) {
      setDocumentType('id');
      setDocumentNumber(emp.idNumber);
    } else if (emp.idNumber) {
      // Default to ID if both exist
      setDocumentType('id');
      setDocumentNumber(emp.idNumber);
    } else {
      setDocumentType('');
      setDocumentNumber('');
    }
  }, []);

  /* ── Handle Site Selection ── */
  const handleSiteSelect = useCallback(async (site: Site) => {
    setSelectedSite(site);
    setIsChangingTeamLeader(false);
    await findTeamLeaderForSite(site.id);
  }, [findTeamLeaderForSite]);

  /* ── Handle Team Leader Selection ── */
  const handleTeamLeaderSelect = useCallback(async (emp: Employee) => {
    if (!selectedSite) return;

    setIsSettingTeamLeader(true);
    try {
      // If there's an existing team leader for this site, remove their leader status first
      if (currentTeamLeader && currentTeamLeader.id !== emp.id) {
        const removeRes = await fetch(`/api/employees/${currentTeamLeader.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isTeamLeader: false,
            teamLeaderSiteId: null,
          }),
        });
        if (!removeRes.ok) {
          const removeJson = await removeRes.json();
          toast({
            title: 'Error',
            description: removeJson.error || 'Failed to remove previous team leader',
            variant: 'destructive',
          });
          setIsSettingTeamLeader(false);
          return;
        }
      }

      // Set the new team leader
      const tlRes = await fetch(`/api/employees/${emp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTeamLeader: true,
          teamLeaderSiteId: selectedSite.id,
        }),
      });
      const tlJson = await tlRes.json();
      if (!tlJson.success) {
        toast({
          title: 'Team Leader Error',
          description: tlJson.error || 'Failed to set team leader',
          variant: 'destructive',
        });
        setIsSettingTeamLeader(false);
        return;
      }

      // Update local state
      setTeamLeaderName(emp.fullName);
      setCurrentTeamLeader(emp);
      setIsChangingTeamLeader(false);

      // Update the employees list to reflect team leader changes
      setEmployees((prev) =>
        prev.map((e) => {
          if (e.id === emp.id) {
            return { ...e, isTeamLeader: true, teamLeaderSiteId: selectedSite.id };
          }
          if (currentTeamLeader && e.id === currentTeamLeader.id) {
            return { ...e, isTeamLeader: false, teamLeaderSiteId: null };
          }
          return e;
        })
      );
      setSiteEmployees((prev) =>
        prev.map((e) => {
          if (e.id === emp.id) {
            return { ...e, isTeamLeader: true, teamLeaderSiteId: selectedSite.id };
          }
          if (currentTeamLeader && e.id === currentTeamLeader.id) {
            return { ...e, isTeamLeader: false, teamLeaderSiteId: null };
          }
          return e;
        })
      );

      toast({
        title: 'Team Leader Set',
        description: `${emp.fullName} has been set as team leader of ${selectedSite.name}.`,
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to set team leader', variant: 'destructive' });
    } finally {
      setIsSettingTeamLeader(false);
    }
  }, [selectedSite, currentTeamLeader]);

  /* ── Handle Create Entry ── */
  const handleCreateEntry = useCallback(async () => {
    if (!selectedEmployee) {
      toast({ title: 'Validation Error', description: 'Please select an employee', variant: 'destructive' });
      return;
    }
    if (!documentType) {
      toast({ title: 'Validation Error', description: 'Please select a document type', variant: 'destructive' });
      return;
    }
    if (!documentNumber.trim()) {
      toast({ title: 'Validation Error', description: 'Please enter a document number', variant: 'destructive' });
      return;
    }

    const activeItems = (Object.keys(items) as (keyof ItemsMap)[]).filter((k) => items[k]);
    if (activeItems.length === 0) {
      toast({ title: 'Validation Error', description: 'Please select at least one item', variant: 'destructive' });
      return;
    }

    // Proceed with creation (team leader is already set via the dropdown)
    await doCreateEntry(false);
  }, [selectedEmployee, documentType, documentNumber, items, selectedSite, teamLeaderName]);

  /* ── Actually Create Entry ── */
  const doCreateEntry = useCallback(async (setAsTeamLeader: boolean) => {
    if (!selectedEmployee) return;

    setIsSubmitting(true);
    try {
      // If setting as team leader, call the employee API first
      if (setAsTeamLeader && selectedSite) {
        const tlRes = await fetch(`/api/employees/${selectedEmployee.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isTeamLeader: true,
            teamLeaderSiteId: selectedSite.id,
          }),
        });
        const tlJson = await tlRes.json();
        if (!tlJson.success) {
          toast({
            title: 'Team Leader Error',
            description: tlJson.error || 'Failed to set team leader',
            variant: 'destructive',
          });
          setIsSubmitting(false);
          return;
        }
        setTeamLeaderName(selectedEmployee.fullName);
      }

      const itemsJson = JSON.stringify(items);
      const sizesJson = JSON.stringify(itemSizes);

      const res = await fetch('/api/uniform-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName: selectedEmployee.fullName,
          employeeId: selectedEmployee.id,
          documentType,
          documentNumber: documentNumber.trim(),
          items: itemsJson,
          sizes: sizesJson,
          siteName: selectedSite?.name || null,
          teamLeaderName: setAsTeamLeader ? selectedEmployee.fullName : teamLeaderName,
          isRenewal,
          previousTokenId,
        }),
      });

      const json = await res.json();
      if (json.success && json.data?.entry) {
        toast({
          title: isRenewal ? 'Entry Renewed' : 'Entry Created',
          description: `Uniform registry entry for ${selectedEmployee.fullName} has been ${isRenewal ? 'renewed' : 'created'} successfully.`,
        });
        setCreateDialogOpen(false);
        resetForm();
        fetchEntries();
      } else {
        toast({
          title: 'Error',
          description: json.error || 'Failed to create entry',
          variant: 'destructive',
        });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedEmployee, documentType, documentNumber, items, itemSizes, selectedSite, teamLeaderName, isRenewal, previousTokenId, fetchEntries]);

  /* ── Reset form ── */
  const resetForm = useCallback(() => {
    setSelectedEmployee(null);
    setDocumentType('');
    setDocumentNumber('');
    setItems({ ...DEFAULT_ITEMS });
    setItemSizes({});
    setSelectedSite(null);
    setTeamLeaderName(null);
    setCurrentTeamLeader(null);
    setSiteEmployees([]);
    setIsChangingTeamLeader(false);
    setIsRenewal(false);
    setPreviousTokenId(null);
  }, []);

  /* ── View Details ── */
  const openDetails = useCallback(async (entry: UniformEntry) => {
    setViewingEntryDetails(entry);
  }, []);

  /* ── Delete Entry ── */
  const handleDelete = useCallback(async () => {
    if (!deletingEntry) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/uniform-registry/${deletingEntry.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        toast({
          title: 'Entry Deleted',
          description: `Token #${deletingEntry.tokenNumber} has been removed.`,
        });
        setDeleteDialogOpen(false);
        setDeletingEntry(null);
        fetchEntries();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to delete entry', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete entry', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  }, [deletingEntry, fetchEntries]);

  /* ── Reset Filters ── */
  const resetFilters = () => {
    setSearchQuery('');
    setSiteFilter('all');
    setPage(1);
  };

  const hasFilters = debouncedSearch || siteFilter !== 'all';

  /* ── Pagination ── */
  const renderPagination = () => {
    if (totalPages <= 1) return null;
    const pages: (number | 'dots')[] = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    start = Math.max(1, end - maxVisible + 1);

    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push('dots');
    }
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    if (end < totalPages) {
      if (end < totalPages - 1) pages.push('dots');
      pages.push(totalPages);
    }

    return (
      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/50">
        <p className="text-sm text-slate-400">
          Showing {Math.min((page - 1) * 10 + 1, total)}&ndash;{Math.min(page * 10, total)} of {total} entries
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-700"
            onClick={() => setPage(1)}
            disabled={page === 1}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-700"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {pages.map((p, idx) =>
            p === 'dots' ? (
              <span key={`dots-${idx}`} className="px-1 text-slate-500">...</span>
            ) : (
              <Button
                key={p}
                variant={p === page ? 'default' : 'ghost'}
                size="icon"
                className={
                  p === page
                    ? 'h-8 w-8 bg-blue-500 hover:bg-blue-600 text-white'
                    : 'h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-700'
                }
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            )
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-700"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-700"
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  /* ───────── RENDER ───────── */

  // If viewing entry details page, show full-page details view instead of the list
  if (viewingEntryDetails) {
    return (
      <UniformEntryDetails
        entry={viewingEntryDetails}
        onBack={() => setViewingEntryDetails(null)}
        onRenew={(entry) => {
          setViewingEntryDetails(null);
          openRenewDialog(entry);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Materials Registry</h2>
          <p className="text-slate-400 mt-1">
            Track material and equipment distribution for employees.
          </p>
        </div>
        {activeTab === 'tokens' && (
          <Button
            onClick={openCreateDialog}
            className="bg-blue-500 hover:bg-blue-600 text-white gap-2 self-start"
          >
            <Plus className="h-4 w-4" />
            New Entry
          </Button>
        )}
      </div>

      {/* Tab Toggle */}
      <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 p-0.5 w-fit">
        <button
          onClick={() => setActiveTab('tokens')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            activeTab === 'tokens' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-white'
          )}
        >
          <FileText className="h-4 w-4" />
          Tokens
        </button>
        <button
          onClick={() => setActiveTab('stock')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            activeTab === 'stock' ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white'
          )}
        >
          <Package className="h-4 w-4" />
          Stock Management
        </button>
      </div>

      {activeTab === 'stock' ? (
        <StockManagement />
      ) : (
      <>
      <Card className="bg-slate-800 border-slate-700 rounded-xl">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by employee name, token number, document number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 h-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger className="w-[180px] bg-slate-900 border-slate-600 text-white h-9">
                  <SelectValue placeholder="All Sites" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="all">All Sites</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.name}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button
                  variant="ghost"
                  onClick={resetFilters}
                  className="h-9 text-slate-400 hover:text-white hover:bg-slate-700 gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-slate-800 border-slate-700 rounded-xl overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-700/50 mb-4">
              <Shirt className="h-8 w-8 text-slate-500" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">
              {hasFilters ? 'No entries found' : 'No entries yet'}
            </h3>
            <p className="text-sm text-slate-500 max-w-sm">
              {hasFilters
                ? 'Try adjusting your search terms or filters.'
                : 'Create your first uniform registry entry to get started.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50 hover:bg-transparent">
                    <TableHead className="text-slate-400 font-medium">Token #</TableHead>
                    <TableHead className="text-slate-400 font-medium">Employee</TableHead>
                    <TableHead className="text-slate-400 font-medium">Document</TableHead>
                    <TableHead className="text-slate-400 font-medium">Items</TableHead>
                    <TableHead className="text-slate-400 font-medium">Site</TableHead>
                    <TableHead className="text-slate-400 font-medium">Team Leader</TableHead>
                    <TableHead className="text-slate-400 font-medium">Created</TableHead>
                    <TableHead className="text-slate-400 font-medium">Renewal</TableHead>
                    <TableHead className="text-slate-400 font-medium text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const renewalStatus = getRenewalStatus(entry.renewalDate);
                    return (
                      <TableRow
                        key={entry.id}
                        className="border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors"
                        onClick={() => openDetails(entry)}
                      >
                        <TableCell>
                          <span className="text-sm font-mono text-blue-400 font-semibold">
                            #{entry.tokenNumber}
                          </span>
                          {entry.isRenewal && (
                            <Badge className="ml-1.5 bg-purple-500/15 text-purple-400 border-purple-500/25 text-[10px] px-1 py-0">
                              Renewal
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium text-white">{entry.employeeName}</p>
                        </TableCell>
                        <TableCell>
                          <div>
                            <Badge
                              className={cn(
                                'text-[10px] px-1.5 py-0 mb-0.5',
                                entry.documentType === 'passport'
                                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                                  : 'bg-slate-500/15 text-slate-400 border-slate-500/25'
                              )}
                            >
                              {entry.documentType === 'passport' ? 'Passport' : 'ID'}
                            </Badge>
                            <p className="text-xs text-slate-400 font-mono">{entry.documentNumber}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <ItemBadges itemsStr={entry.items} />
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-slate-300">
                            {entry.siteName || <span className="text-slate-600">&mdash;</span>}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-slate-300">
                            {entry.teamLeaderName ? (
                              <span className="flex items-center gap-1">
                                <Shield className="h-3 w-3 text-blue-400" />
                                {entry.teamLeaderName}
                              </span>
                            ) : (
                              <span className="text-slate-600">&mdash;</span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-400">{formatDate(entry.createdAt)}</span>
                        </TableCell>
                        <TableCell>
                          <RenewalStatusBadge renewalDate={entry.renewalDate} />
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                              onClick={() => openDetails(entry)}
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {renewalStatus.variant === 'green' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-green-400 hover:bg-green-500/10"
                                onClick={() => openRenewDialog(entry)}
                                title="Renew"
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                              onClick={() => {
                                setDeletingEntry(entry);
                                setDeleteDialogOpen(true);
                              }}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile & Tablet Cards */}
            <div className="lg:hidden divide-y divide-slate-700/50">
              {entries.map((entry) => {
                const renewalStatus = getRenewalStatus(entry.renewalDate);
                return (
                  <div
                    key={entry.id}
                    className="p-4 hover:bg-slate-700/20 cursor-pointer transition-colors"
                    onClick={() => openDetails(entry)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-blue-400 font-semibold">
                          #{entry.tokenNumber}
                        </span>
                        {entry.isRenewal && (
                          <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/25 text-[10px] px-1 py-0">
                            Renewal
                          </Badge>
                        )}
                      </div>
                      <RenewalStatusBadge renewalDate={entry.renewalDate} />
                    </div>
                    <p className="text-sm font-medium text-white mb-1">{entry.employeeName}</p>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        className={cn(
                          'text-[10px] px-1.5 py-0',
                          entry.documentType === 'passport'
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                            : 'bg-slate-500/15 text-slate-400 border-slate-500/25'
                        )}
                      >
                        {entry.documentType === 'passport' ? 'Passport' : 'ID'}
                      </Badge>
                      <span className="text-xs text-slate-400 font-mono">{entry.documentNumber}</span>
                    </div>
                    <div className="mb-2">
                      <ItemBadges itemsStr={entry.items} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <div>
                        <span className="text-slate-500">Site:</span>{' '}
                        <span className="text-slate-300">{entry.siteName || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Leader:</span>{' '}
                        <span className="text-slate-300">{entry.teamLeaderName || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Created:</span>{' '}
                        <span className="text-slate-300">{formatDate(entry.createdAt)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Renewal:</span>{' '}
                        <span className="text-slate-300">{formatDate(entry.renewalDate)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-blue-400"
                        onClick={() => openDetails(entry)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {renewalStatus.variant === 'green' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-green-400"
                          onClick={() => openRenewDialog(entry)}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-red-400"
                        onClick={() => {
                          setDeletingEntry(entry);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {renderPagination()}
          </>
        )}
      </Card>

      {/* ──────── Create / Renew Entry Dialog ──────── */}
      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            resetForm();
          }
        }}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-200 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">
              {isRenewal ? 'Renew Material Entry' : 'New Materials Registry Entry'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {isRenewal
                ? 'Create a renewed entry with updated items and new renewal date.'
                : 'Register a new uniform and equipment distribution entry.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-2">
            {/* Employee Selection */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">
                Employee <span className="text-red-400">*</span>
              </Label>
              <EmployeeCombobox
                employees={employees}
                selectedEmployee={selectedEmployee}
                onSelect={handleEmployeeSelect}
                loading={loadingEmployees}
              />
            </div>

            {/* Document Type & Number */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">
                  Document Type <span className="text-red-400">*</span>
                </Label>
                <Select value={documentType} onValueChange={(val) => {
                  setDocumentType(val);
                  // Auto-fill document number based on the selected type
                  if (selectedEmployee) {
                    if (val === 'id' && selectedEmployee.idNumber) {
                      setDocumentNumber(selectedEmployee.idNumber);
                    } else if (val === 'passport' && selectedEmployee.passportNumber) {
                      setDocumentNumber(selectedEmployee.passportNumber);
                    } else {
                      // Keep current value if no matching document number
                    }
                  }
                }}>
                  <SelectTrigger className="bg-slate-900 border-slate-600 text-white">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="id">
                      <span className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5" />
                        ID
                      </span>
                    </SelectItem>
                    <SelectItem value="passport">
                      <span className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5" />
                        Passport
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">
                  Document Number <span className="text-red-400">*</span>
                </Label>
                <Input
                  placeholder="e.g. A12345678"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Items Checkboxes + Size Selectors */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">
                Items Given <span className="text-red-400">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                {(Object.keys(DEFAULT_ITEMS) as (keyof ItemsMap)[]).map((key) => {
                  const isChecked = items[key];
                  // Items that require a size selection
                  const needsSize = key === 'uniform' || key === 'shoes';
                  // Available sizes from stock for this item.
                  // Match stock itemName against both the camelCase key and the
                  // human-readable label (case- and space-insensitive), so stock
                  // entered as "Uniform" / "Safety Jacket" shows up here.
                  const availableSizes = stockItems
                    .filter((s) => stockMatchesKey(s.itemName, key) && s.quantity > 0)
                    .map((s) => s.size || 'One Size');

                  return (
                    <div key={key} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`item-${key}`}
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            setItems((prev) => ({ ...prev, [key]: !!checked }));
                            if (!checked) {
                              setItemSizes((prev) => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                            }
                          }}
                          className="border-slate-600 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                        />
                        <label
                          htmlFor={`item-${key}`}
                          className="text-sm text-slate-300 cursor-pointer select-none"
                        >
                          {ITEM_ICONS[key]} {ITEM_LABELS[key]}
                        </label>
                        {isChecked && needsSize && availableSizes.length > 0 && (
                          <Badge className="bg-slate-700 text-slate-400 text-[9px] px-1.5 py-0 h-4 ml-auto">
                            {stockItems.filter(s => stockMatchesKey(s.itemName, key) && s.quantity > 0).reduce((sum, s) => sum + s.quantity, 0)} in stock
                          </Badge>
                        )}
                      </div>
                      {/* Size dropdown for uniform and shoes when checked */}
                      {isChecked && needsSize && (
                        <div className="pl-6">
                          {availableSizes.length > 0 ? (
                            <Select
                              value={itemSizes[key] || ''}
                              onValueChange={(val) => setItemSizes((prev) => ({ ...prev, [key]: val }))}
                            >
                              <SelectTrigger className="h-7 text-xs bg-slate-900 border-slate-600 text-white w-[140px]">
                                <SelectValue placeholder="Select size" />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-800 border-slate-600">
                                {availableSizes.map((size) => (
                                  <SelectItem key={size} value={size} className="text-slate-200 focus:bg-slate-700 focus:text-white">
                                    {size}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="text-[10px] text-amber-400/80">No stock for this item. Add stock in the Stock Management tab first.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Site Selection */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Site</Label>
              <SiteCombobox
                sites={sites}
                selectedSite={selectedSite}
                onSelect={handleSiteSelect}
                loading={false}
              />
            </div>

            {/* Team Leader */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Team Leader</Label>
              <TeamLeaderCombobox
                siteEmployees={siteEmployees}
                currentTeamLeader={currentTeamLeader}
                isChangingTeamLeader={isChangingTeamLeader}
                selectedSite={selectedSite}
                teamLeaderLoading={teamLeaderLoading}
                isSettingTeamLeader={isSettingTeamLeader}
                onSelectEmployee={handleTeamLeaderSelect}
                onChangeLeaderClick={() => setChangeLeaderConfirmOpen(true)}
              />
              {selectedSite && !currentTeamLeader && siteEmployees.length > 0 && !teamLeaderLoading && (
                <p className="text-xs text-amber-400/80 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  No team leader set for this site. Select one above.
                </p>
              )}
              {selectedSite && siteEmployees.length === 0 && !teamLeaderLoading && (
                <p className="text-xs text-slate-500">
                  No active employees found at this site.
                </p>
              )}
            </div>

            {/* Renewal info (if renewing) */}
            {isRenewal && previousTokenId && (
              <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <p className="text-xs text-purple-400 flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  This is a renewal entry. A new token number will be assigned automatically.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setCreateDialogOpen(false);
                resetForm();
              }}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateEntry}
              disabled={isSubmitting || !selectedEmployee}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isRenewal ? 'Renewing...' : 'Creating...'}
                </>
              ) : isRenewal ? (
                'Renew Entry'
              ) : (
                'Create Entry'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────── Change Team Leader Confirmation Dialog ──────── */}
      <AlertDialog open={changeLeaderConfirmOpen} onOpenChange={setChangeLeaderConfirmOpen}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Change Team Leader?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              The current team leader of{' '}
              <span className="text-white font-semibold">{selectedSite?.name}</span> is{' '}
              <span className="text-white font-semibold">{currentTeamLeader?.fullName}</span>.
              Are you sure you want to change the team leader? You will be able to select a new team leader from the employees of this site.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setChangeLeaderConfirmOpen(false);
                setIsChangingTeamLeader(true);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Yes, change leader
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ──────── View Details Dialog ──────── */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-200 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Entry Details</DialogTitle>
            <DialogDescription className="text-slate-400">
              Full details for uniform registry entry
            </DialogDescription>
          </DialogHeader>

          {detailsLoading ? (
            <div className="space-y-4 py-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full bg-slate-700" />
              ))}
            </div>
          ) : viewingEntry ? (
            <div className="space-y-4 py-2">
              {/* Token Number */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <span className="text-lg font-bold text-blue-400">#{viewingEntry.tokenNumber}</span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">{viewingEntry.employeeName}</h3>
                    <p className="text-xs text-slate-500">
                      {viewingEntry.isRenewal ? 'Renewal entry' : 'Original entry'}
                    </p>
                  </div>
                </div>
                <RenewalStatusBadge renewalDate={viewingEntry.renewalDate} />
              </div>

              <Separator className="bg-slate-700/50" />

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Document Type</p>
                  <Badge
                    className={cn(
                      'text-xs',
                      viewingEntry.documentType === 'passport'
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                        : 'bg-slate-500/15 text-slate-400 border-slate-500/25'
                    )}
                  >
                    {viewingEntry.documentType === 'passport' ? 'Passport' : 'ID'}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Document Number</p>
                  <p className="text-sm text-white font-mono">{viewingEntry.documentNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Site</p>
                  <p className="text-sm text-white">{viewingEntry.siteName || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Team Leader</p>
                  <p className="text-sm text-white">
                    {viewingEntry.teamLeaderName ? (
                      <span className="flex items-center gap-1">
                        <Shield className="h-3.5 w-3.5 text-blue-400" />
                        {viewingEntry.teamLeaderName}
                      </span>
                    ) : (
                      '—'
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Created</p>
                  <p className="text-sm text-white flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    {formatDateTime(viewingEntry.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Renewal Date</p>
                  <p className="text-sm text-white flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    {formatDate(viewingEntry.renewalDate)}
                  </p>
                </div>
              </div>

              <Separator className="bg-slate-700/50" />

              {/* Items */}
              <div>
                <p className="text-xs text-slate-500 mb-2">Items Given</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(DEFAULT_ITEMS) as (keyof ItemsMap)[]).map((key) => {
                    const parsedItems = parseItems(viewingEntry.items);
                    const isActive = parsedItems[key];
                    return (
                      <div
                        key={key}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm',
                          isActive
                            ? 'bg-blue-500/10 border-blue-500/25 text-blue-400'
                            : 'bg-slate-700/30 border-slate-700/50 text-slate-500 line-through'
                        )}
                      >
                        {isActive ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        {ITEM_ICONS[key]} {ITEM_LABELS[key]}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Renewal info */}
              {viewingEntry.isRenewal && viewingEntry.previousTokenId && (
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <p className="text-xs text-purple-400">
                    This is a renewal of a previous entry (Token ID: {viewingEntry.previousTokenId})
                  </p>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            {viewingEntry && getRenewalStatus(viewingEntry.renewalDate).variant === 'green' && (
              <Button
                variant="outline"
                onClick={() => {
                  setDetailsDialogOpen(false);
                  openRenewDialog(viewingEntry);
                }}
                className="bg-slate-700 border-slate-600 text-green-400 hover:text-green-300 hover:bg-slate-600 gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                Renew
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => setDetailsDialogOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </>
      )}

      {/* ──────── Delete Confirmation Dialog ──────── */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Delete Entry
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Are you sure you want to delete entry{' '}
              <span className="text-white font-semibold">#{deletingEntry?.tokenNumber}</span> for{' '}
              <span className="text-white font-semibold">{deletingEntry?.employeeName}</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600"
              disabled={isDeleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                'Delete Entry'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────── Stock Management Component ───────── */

interface StockItemData {
  id: string;
  itemName: string;
  size: string | null;
  quantity: number;
  minQuantity: number;
  updatedAt: string;
}

function StockManagement() {
  const [stockItems, setStockItems] = useState<StockItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemSize, setNewItemSize] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const [newItemMin, setNewItemMin] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchStock = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/stock');
      const json = await res.json();
      if (json.success) {
        setStockItems(json.data.stockItems || []);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load stock', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const handleAddStock = async () => {
    if (!newItemName.trim()) {
      toast({ title: 'Error', description: 'Item name is required', variant: 'destructive' });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemName: newItemName.trim(),
          size: newItemSize.trim() || null,
          quantity: parseInt(newItemQty) || 0,
          minQuantity: parseInt(newItemMin) || 0,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Stock Added', description: `${newItemName} added to stock` });
        setNewItemName('');
        setNewItemSize('');
        setNewItemQty('');
        setNewItemMin('');
        setShowAddForm(false);
        fetchStock();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to add stock', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to add stock', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleUpdateQty = async (id: string, newQty: number) => {
    try {
      const res = await fetch('/api/stock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, quantity: Math.max(0, newQty) }),
      });
      const json = await res.json();
      if (json.success) {
        setStockItems((prev) => prev.map((i) => i.id === id ? { ...i, quantity: Math.max(0, newQty) } : i));
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update quantity', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this stock item?')) return;
    try {
      await fetch(`/api/stock?id=${id}`, { method: 'DELETE' });
      setStockItems((prev) => prev.filter((i) => i.id !== id));
      toast({ title: 'Deleted', description: 'Stock item removed' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete', variant: 'destructive' });
    }
  };

  // Group by itemName
  const grouped = useMemo(() => {
    const map = new Map<string, StockItemData[]>();
    for (const item of stockItems) {
      if (!map.has(item.itemName)) map.set(item.itemName, []);
      map.get(item.itemName)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [stockItems]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Manage material stock by item and size. Quantities are automatically reduced when tokens are issued.
        </p>
        <Button onClick={() => setShowAddForm(!showAddForm)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
          <Plus className="h-4 w-4" />
          Add Stock
        </Button>
      </div>

      {showAddForm && (
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-slate-300 text-xs mb-1">Item Name *</Label>
                <Input placeholder="e.g. Uniform, Shoes" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} className="bg-slate-900 border-slate-600 text-white" />
              </div>
              <div>
                <Label className="text-slate-300 text-xs mb-1">Size</Label>
                <Input placeholder="e.g. L, XL, 42" value={newItemSize} onChange={(e) => setNewItemSize(e.target.value)} className="bg-slate-900 border-slate-600 text-white" />
              </div>
              <div>
                <Label className="text-slate-300 text-xs mb-1">Quantity *</Label>
                <Input type="number" min="0" placeholder="0" value={newItemQty} onChange={(e) => setNewItemQty(e.target.value)} className="bg-slate-900 border-slate-600 text-white" />
              </div>
              <div>
                <Label className="text-slate-300 text-xs mb-1">Min Qty (alert)</Label>
                <Input type="number" min="0" placeholder="0" value={newItemMin} onChange={(e) => setNewItemMin(e.target.value)} className="bg-slate-900 border-slate-600 text-white" />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button onClick={handleAddStock} disabled={adding} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save
              </Button>
              <Button variant="ghost" onClick={() => setShowAddForm(false)} className="text-slate-400">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Skeleton className="h-48 bg-slate-800 rounded-lg" />
      ) : stockItems.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="py-16 text-center">
            <Package className="h-10 w-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No stock items yet</p>
            <p className="text-xs text-slate-500 mt-1">Click "Add Stock" to create your first stock item.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([itemName, items]) => (
            <Card key={itemName} className="bg-slate-800/50 border-slate-700/50 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-900/40 border-b border-slate-700/50 flex items-center gap-2">
                <Package className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-bold text-white">{itemName}</span>
                <Badge className="bg-slate-700 text-slate-300 text-[10px] ml-auto">
                  {items.reduce((s, i) => s + i.quantity, 0)} total
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/30 text-xs text-slate-400">
                      <th className="text-left px-4 py-2 font-medium">Size</th>
                      <th className="text-right px-4 py-2 font-medium">Quantity</th>
                      <th className="text-right px-4 py-2 font-medium">Min Qty</th>
                      <th className="text-center px-4 py-2 font-medium">Status</th>
                      <th className="text-right px-4 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const isLow = item.quantity <= item.minQuantity;
                      const isOut = item.quantity === 0;
                      return (
                        <tr key={item.id} className="border-b border-slate-700/20 hover:bg-slate-700/20">
                          <td className="px-4 py-2.5 text-slate-300 font-mono">{item.size || 'One Size'}</td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => handleUpdateQty(item.id, item.quantity - 1)} className="h-5 w-5 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center">
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className={cn('text-sm font-bold font-mono w-10 text-center', isOut ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-white')}>{item.quantity}</span>
                              <button onClick={() => handleUpdateQty(item.id, item.quantity + 1)} className="h-5 w-5 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center">
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-400 font-mono">{item.minQuantity}</td>
                          <td className="px-4 py-2.5 text-center">
                            {isOut ? <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px]">Out of Stock</Badge>
                              : isLow ? <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">Low Stock</Badge>
                              : <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">In Stock</Badge>}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button onClick={() => handleDelete(item.id)} className="text-slate-500 hover:text-red-400 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
