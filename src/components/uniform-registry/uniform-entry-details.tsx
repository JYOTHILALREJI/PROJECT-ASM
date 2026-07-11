'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Edit2, Save, X, Loader2, Check, RefreshCw, Plus, Calendar, Building2, Shield, FileText, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

/* ───────── Types ───────── */

interface UniformEntry {
  id: string;
  tokenNumber: number;
  employeeName: string;
  employeeId: string;
  documentType: string;
  documentNumber: string;
  items: string;
  siteName: string | null;
  teamLeaderName: string | null;
  isRenewal: boolean;
  previousTokenId: string | null;
  isDeleted: boolean;
  createdAt: string;
  renewalDate: string;
  employee?: {
    id: string;
    fullName: string;
    employeeId: string;
    isTeamLeader: boolean;
    currentSite: string | null;
    photo: string | null;
  };
}

interface Site {
  id: string;
  name: string;
}

interface EmployeeData {
  id: string;
  fullName: string;
  employeeId: string;
  passportNumber: string | null;
  idNumber: string | null;
  currentSite: string | null;
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
  uniform: 'UNIFORM',
  shoes: 'SHOES',
  helmet: 'HELMET',
  bottle: 'BOTTLE',
  safetyJacket: 'SAFETY JACKET',
  mattress: 'MATTRESS',
  pillow: 'PILLOW',
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

interface MonthGroup {
  key: string;
  label: string;
  entries: UniformEntry[];
  status: 'expired' | 'expiring' | 'active';
}

interface Props {
  entry: UniformEntry;
  onBack: () => void;
  onRenew?: (entry: UniformEntry) => void;
}

/* ───────── Helpers ───────── */

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(key: string): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const [year, month] = key.split('-');
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

function formatDateShort(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).toUpperCase();
  } catch {
    return dateStr;
  }
}

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

/* ───────── Site Combobox ───────── */

function SiteCombobox({
  sites,
  selectedSite,
  onSelect,
}: {
  sites: Site[];
  selectedSite: Site | null;
  onSelect: (site: Site) => void;
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
          className="w-full justify-start bg-slate-900 border-slate-600 text-white hover:bg-slate-800 hover:text-white font-normal"
        >
          <Building2 className="h-4 w-4 mr-2 text-slate-400" />
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

/* ───────── Main Component ───────── */

export function UniformEntryDetails({ entry, onBack, onRenew }: Props) {
  const [allEntries, setAllEntries] = useState<UniformEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Add New Record dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addDocType, setAddDocType] = useState<string>('id');
  const [addDocNumber, setAddDocNumber] = useState('');
  const [addItems, setAddItems] = useState<ItemsMap>({ ...DEFAULT_ITEMS });
  const [addSite, setAddSite] = useState<Site | null>(null);
  const [addTeamLeader, setAddTeamLeader] = useState('');
  const [addCreatedAt, setAddCreatedAt] = useState(toDateString(new Date()));
  const [addRenewalDate, setAddRenewalDate] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [employeeData, setEmployeeData] = useState<EmployeeData | null>(null);

  // Employee info derived from the entry
  const employeeDbId = entry.employeeId; // Database ID (cuid)
  const employeeDisplayId = entry.employee?.employeeId || entry.employeeId; // Human-readable ID

  // Calculate renewal date from creation date
  useEffect(() => {
    if (addCreatedAt) {
      const d = new Date(addCreatedAt);
      d.setMonth(d.getMonth() + 6);
      setAddRenewalDate(toDateString(d));
    }
  }, [addCreatedAt]);

  // Fetch all entries for this employee
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/uniform-registry/employee/${employeeDbId}`);
      const json = await res.json();
      if (json.success) {
        const entries: UniformEntry[] = json.data.entries || [];
        setAllEntries(entries);
        // Auto-select the month of the clicked entry
        const entryMonth = getMonthKey(entry.createdAt);
        if (entries.length > 0) {
          setSelectedMonth(entryMonth);
        }
      }
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  }, [employeeDbId, entry.createdAt]);

  // Fetch sites for the add new form
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

  // Fetch employee data (for document number auto-fill)
  const fetchEmployeeData = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees/${employeeDbId}`);
      const json = await res.json();
      if (json.success && json.data?.employee) {
        setEmployeeData({
          id: json.data.employee.id,
          fullName: json.data.employee.fullName,
          employeeId: json.data.employee.employeeId,
          passportNumber: json.data.employee.passportNumber || null,
          idNumber: json.data.employee.idNumber || null,
          currentSite: json.data.employee.currentSite || null,
        });
      }
    } catch {
      // silent
    }
  }, [employeeDbId]);

  useEffect(() => {
    fetchEntries();
    fetchSites();
    fetchEmployeeData();
  }, [fetchEntries, fetchSites, fetchEmployeeData]);

  // Group entries by month
  const monthGroups = useMemo((): MonthGroup[] => {
    const groups = new Map<string, UniformEntry[]>();
    allEntries.forEach((e) => {
      const key = getMonthKey(e.createdAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    });

    const sorted = Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));

    return sorted.map(([key, entries]) => {
      const now = new Date();
      let hasExpired = false;
      let hasExpiring = false;
      let hasActive = false;

      entries.forEach((e) => {
        const renewal = new Date(e.renewalDate);
        const diffDays = Math.ceil((renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) hasExpired = true;
        else if (diffDays <= 30) hasExpiring = true;
        else hasActive = true;
      });

      let status: 'expired' | 'expiring' | 'active' = 'active';
      if (hasExpired) status = 'expired';
      else if (hasExpiring) status = 'expiring';

      return {
        key,
        label: getMonthLabel(key),
        entries,
        status,
      };
    });
  }, [allEntries]);

  // Selected month's entries
  const selectedEntries = useMemo(() => {
    const group = monthGroups.find(g => g.key === selectedMonth);
    return group?.entries || [];
  }, [monthGroups, selectedMonth]);

  // Start editing
  const startEdit = useCallback((entryItem: UniformEntry) => {
    setEditingId(entryItem.id);
    setEditData({
      siteName: entryItem.siteName || '',
      teamLeaderName: entryItem.teamLeaderName || '',
      documentType: entryItem.documentType,
      documentNumber: entryItem.documentNumber,
      items: parseItems(entryItem.items),
      createdAt: toDateString(new Date(entryItem.createdAt)),
    });
  }, []);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditData({});
  }, []);

  // Save edit
  const saveEdit = useCallback(async (entryId: string) => {
    setSaving(true);
    try {
      const items = editData.items as ItemsMap;
      const updatePayload: Record<string, unknown> = {
        items: JSON.stringify(items),
        siteName: editData.siteName,
        teamLeaderName: editData.teamLeaderName,
        documentType: editData.documentType,
        documentNumber: editData.documentNumber,
      };

      // If createdAt is changed, send it too (renewalDate will be auto-calculated)
      if (editData.createdAt) {
        updatePayload.createdAt = editData.createdAt;
      }

      const res = await fetch(`/api/uniform-registry/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Updated', description: 'Entry updated successfully.' });
        // Refresh entries
        const refreshRes = await fetch(`/api/uniform-registry/employee/${employeeDbId}`);
        const refreshJson = await refreshRes.json();
        if (refreshJson.success) {
          setAllEntries(refreshJson.data.entries || []);
        }
        setEditingId(null);
        setEditData({});
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to update entry', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update entry', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [editData, employeeDbId]);

  // Open Add New dialog
  const openAddNewDialog = useCallback(() => {
    // Pre-fill with last record's doc type and number as defaults
    const lastEntry = allEntries.length > 0 ? allEntries[0] : entry; // allEntries is desc order, so first = latest
    setAddDocType(lastEntry.documentType);
    // Use employee data for the document number if available and matches the type
    if (employeeData) {
      if (lastEntry.documentType === 'id' && employeeData.idNumber) {
        setAddDocNumber(employeeData.idNumber);
      } else if (lastEntry.documentType === 'passport' && employeeData.passportNumber) {
        setAddDocNumber(employeeData.passportNumber);
      } else {
        setAddDocNumber(lastEntry.documentNumber);
      }
    } else {
      setAddDocNumber(lastEntry.documentNumber);
    }
    setAddItems({ ...DEFAULT_ITEMS });
    setAddSite(null);
    setAddTeamLeader('');
    setAddCreatedAt(toDateString(new Date()));
    setAddDialogOpen(true);
  }, [allEntries, entry, employeeData]);

  // Submit new record
  const handleAddNew = useCallback(async () => {
    if (!addDocType) {
      toast({ title: 'Validation Error', description: 'Please select a document type', variant: 'destructive' });
      return;
    }
    if (!addDocNumber.trim()) {
      toast({ title: 'Validation Error', description: 'Please enter a document number', variant: 'destructive' });
      return;
    }

    const activeItems = (Object.keys(addItems) as (keyof ItemsMap)[]).filter((k) => addItems[k]);
    if (activeItems.length === 0) {
      toast({ title: 'Validation Error', description: 'Please select at least one item', variant: 'destructive' });
      return;
    }

    setAddSubmitting(true);
    try {
      const res = await fetch('/api/uniform-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName: entry.employeeName,
          employeeId: employeeDbId,
          documentType: addDocType,
          documentNumber: addDocNumber.trim(),
          items: JSON.stringify(addItems),
          siteName: addSite?.name || null,
          teamLeaderName: addTeamLeader || null,
          isRenewal: false,
          previousTokenId: null,
          createdAt: addCreatedAt || undefined,
        }),
      });

      const json = await res.json();
      if (json.success) {
        toast({
          title: 'Entry Created',
          description: `New uniform registry entry for ${entry.employeeName} has been created successfully.`,
        });
        setAddDialogOpen(false);
        // Refresh entries
        const refreshRes = await fetch(`/api/uniform-registry/employee/${employeeDbId}`);
        const refreshJson = await refreshRes.json();
        if (refreshJson.success) {
          setAllEntries(refreshJson.data.entries || []);
        }
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
      setAddSubmitting(false);
    }
  }, [addDocType, addDocNumber, addItems, addSite, addTeamLeader, addCreatedAt, entry.employeeName, employeeDbId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={onBack}
          className="gap-1.5 bg-black text-white hover:bg-gray-800 border-none shadow-md font-semibold"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white uppercase">
            TOKEN #{entry.tokenNumber} — {entry.employeeName.toUpperCase()}
          </h2>
          <p className="text-sm text-slate-400 uppercase">
            EMPLOYEE ID: {employeeDisplayId} · {allEntries.length} ENTRIES TOTAL
          </p>
        </div>
        <Button
          onClick={openAddNewDialog}
          className="gap-1.5 bg-blue-500 hover:bg-blue-600 text-white font-semibold shrink-0"
        >
          <Plus className="h-4 w-4" />
          Add New
        </Button>
      </div>

      {/* Month Tabs */}
      <div className="flex flex-wrap gap-2">
        {monthGroups.map((group) => (
          <button
            key={group.key}
            onClick={() => setSelectedMonth(group.key)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-bold uppercase transition-all border',
              selectedMonth === group.key
                ? group.status === 'expired'
                  ? 'bg-green-600 text-white border-green-500 shadow-lg shadow-green-500/20'
                  : group.status === 'expiring'
                  ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-500/20'
                  : 'bg-slate-600 text-white border-slate-500 shadow-lg shadow-slate-500/20'
                : group.status === 'expired'
                ? 'bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20'
                : group.status === 'expiring'
                ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
            )}
          >
            {group.label}
            <span className="ml-1.5 opacity-70">({group.entries.length})</span>
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30 border border-red-500/50"></span> EXPIRING SOON</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500/30 border border-green-500/50"></span> EXPIRED / RENEWAL AVAILABLE</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-500/30 border border-slate-500/50"></span> ACTIVE</span>
      </div>

      {/* Entries Table - Dark themed */}
      {selectedEntries.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No entries for this month.
        </div>
      ) : (
        <Card className="bg-slate-800/50 border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px] uppercase">
              <thead>
                <tr className="bg-slate-700/80 text-slate-200">
                  <th className="border border-slate-600 px-3 py-2.5 text-center font-bold">TOKEN #</th>
                  <th className="border border-slate-600 px-3 py-2.5 text-left font-bold">DOC TYPE</th>
                  <th className="border border-slate-600 px-3 py-2.5 text-left font-bold">DOC NUMBER</th>
                  <th className="border border-slate-600 px-3 py-2.5 text-left font-bold">SITE NAME</th>
                  <th className="border border-slate-600 px-3 py-2.5 text-left font-bold">TEAM LEADER</th>
                  <th className="border border-slate-600 px-3 py-2.5 text-left font-bold min-w-[180px]">ITEMS</th>
                  <th className="border border-slate-600 px-3 py-2.5 text-center font-bold">CREATED</th>
                  <th className="border border-slate-600 px-3 py-2.5 text-center font-bold">RENEWAL</th>
                  <th className="border border-slate-600 px-3 py-2.5 text-center font-bold">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {selectedEntries.map((entryItem, idx) => {
                  const isEditing = editingId === entryItem.id;
                  const items = isEditing ? (editData.items as ItemsMap) : parseItems(entryItem.items);
                  const isEven = idx % 2 === 1;

                  const now = new Date();
                  const renewal = new Date(entryItem.renewalDate);
                  const diffDays = Math.ceil((renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                  return (
                    <tr key={entryItem.id} className={cn(
                      isEven ? 'bg-slate-800/40' : 'bg-slate-800/20',
                      'hover:bg-slate-700/30 transition-colors'
                    )}>
                      <td className="border border-slate-700 px-3 py-2 text-center font-bold text-slate-200">
                        #{entryItem.tokenNumber}
                        {entryItem.isRenewal && (
                          <Badge className="ml-1 bg-purple-500/15 text-purple-400 border-purple-500/25 text-[9px] px-1 py-0">
                            RENEWAL
                          </Badge>
                        )}
                      </td>
                      <td className="border border-slate-700 px-3 py-2">
                        {isEditing ? (
                          <Select
                            value={editData.documentType as string}
                            onValueChange={(val) => {
                              setEditData(prev => {
                                const updated = { ...prev, documentType: val };
                                // Auto-fill document number based on the selected type from employee data
                                if (employeeData) {
                                  if (val === 'id' && employeeData.idNumber) {
                                    updated.documentNumber = employeeData.idNumber;
                                  } else if (val === 'passport' && employeeData.passportNumber) {
                                    updated.documentNumber = employeeData.passportNumber;
                                  }
                                }
                                return updated;
                              });
                            }}
                          >
                            <SelectTrigger className="h-7 text-[11px] bg-slate-900 border-slate-600 text-slate-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              <SelectItem value="id">ID</SelectItem>
                              <SelectItem value="passport">PASSPORT</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge
                            className={cn(
                              'text-[10px] px-1.5 py-0',
                              entryItem.documentType === 'passport'
                                ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                                : 'bg-slate-500/15 text-slate-400 border-slate-500/25'
                            )}
                          >
                            {entryItem.documentType === 'passport' ? 'PASSPORT' : 'ID'}
                          </Badge>
                        )}
                      </td>
                      <td className="border border-slate-700 px-3 py-2">
                        {isEditing ? (
                          <Input
                            value={editData.documentNumber as string}
                            onChange={(e) => setEditData(prev => ({ ...prev, documentNumber: e.target.value.toUpperCase() }))}
                            className="h-7 text-[11px] uppercase font-mono bg-slate-900 border-slate-600 text-slate-200"
                          />
                        ) : (
                          <span className="text-slate-300 font-mono">{entryItem.documentNumber.toUpperCase()}</span>
                        )}
                      </td>
                      <td className="border border-slate-700 px-3 py-2">
                        {isEditing ? (
                          <Input
                            value={editData.siteName as string}
                            onChange={(e) => setEditData(prev => ({ ...prev, siteName: e.target.value.toUpperCase() }))}
                            className="h-7 text-[11px] uppercase bg-slate-900 border-slate-600 text-slate-200"
                          />
                        ) : (
                          <span className="text-slate-300">{(entryItem.siteName || '—').toUpperCase()}</span>
                        )}
                      </td>
                      <td className="border border-slate-700 px-3 py-2">
                        {isEditing ? (
                          <Input
                            value={editData.teamLeaderName as string}
                            onChange={(e) => setEditData(prev => ({ ...prev, teamLeaderName: e.target.value.toUpperCase() }))}
                            className="h-7 text-[11px] uppercase bg-slate-900 border-slate-600 text-slate-200"
                          />
                        ) : (
                          <span className="text-slate-300">{(entryItem.teamLeaderName || '—').toUpperCase()}</span>
                        )}
                      </td>
                      <td className="border border-slate-700 px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(Object.keys(items) as (keyof ItemsMap)[]).map((key) => {
                            const checked = items[key];
                            if (isEditing) {
                              return (
                                <label key={key} className="flex items-center gap-0.5 text-[10px] cursor-pointer select-none text-slate-300">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(val) => {
                                      setEditData(prev => ({
                                        ...prev,
                                        items: { ...(prev.items as ItemsMap), [key]: !!val },
                                      }));
                                    }}
                                    className="h-3 w-3"
                                  />
                                  {ITEM_LABELS[key]}
                                </label>
                              );
                            }
                            return checked ? (
                              <Badge key={key} className="bg-blue-500/15 text-blue-400 text-[9px] px-1 py-0 border border-blue-500/25">
                                {ITEM_LABELS[key]}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      </td>
                      <td className="border border-slate-700 px-3 py-2 text-center">
                        {isEditing ? (
                          <Input
                            type="date"
                            value={editData.createdAt as string}
                            onChange={(e) => setEditData(prev => ({ ...prev, createdAt: e.target.value }))}
                            className="h-7 text-[10px] bg-slate-900 border-slate-600 text-slate-200"
                          />
                        ) : (
                          <span className="text-slate-400 text-[10px]">{formatDateShort(entryItem.createdAt)}</span>
                        )}
                      </td>
                      <td className="border border-slate-700 px-3 py-2 text-center text-[10px]">
                        {(() => {
                          const dateStr = formatDateShort(entryItem.renewalDate);
                          if (diffDays <= 0) {
                            return <span className="text-green-400 font-bold">{dateStr}</span>;
                          }
                          if (diffDays <= 30) {
                            return <span className="text-red-400 font-bold">{dateStr}</span>;
                          }
                          return <span className="text-slate-400">{dateStr}</span>;
                        })()}
                      </td>
                      <td className="border border-slate-700 px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          {isEditing ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => saveEdit(entryItem.id)}
                                disabled={saving}
                                className="h-7 w-7 p-0 text-green-400 hover:text-green-300 hover:bg-green-500/10"
                                title="Save"
                              >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={cancelEdit}
                                disabled={saving}
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                title="Cancel"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startEdit(entryItem)}
                                className="h-7 w-7 p-0 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                                title="Edit"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              {diffDays <= 0 && onRenew && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => onRenew(entryItem)}
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-green-400 hover:bg-green-500/10"
                                  title="Renew"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ──────── Add New Record Dialog ──────── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-200 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Add New Uniform Record</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a new uniform registry entry for {entry.employeeName}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-2">
            {/* Employee (preselected, read-only) */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Employee</Label>
              <div className="flex items-center gap-2 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <User className="h-4 w-4 text-slate-400" />
                <span className="text-white text-sm font-medium">{entry.employeeName}</span>
                <span className="text-slate-500 text-xs">({employeeDisplayId})</span>
              </div>
            </div>

            {/* Document Type & Number */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">
                  Document Type <span className="text-red-400">*</span>
                </Label>
                <Select value={addDocType} onValueChange={(val) => {
                  setAddDocType(val);
                  // Auto-fill document number based on the selected type from employee data
                  if (employeeData) {
                    if (val === 'id' && employeeData.idNumber) {
                      setAddDocNumber(employeeData.idNumber);
                    } else if (val === 'passport' && employeeData.passportNumber) {
                      setAddDocNumber(employeeData.passportNumber);
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
                  value={addDocNumber}
                  onChange={(e) => setAddDocNumber(e.target.value)}
                  className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Creation Date & Expiry Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">
                  Date of Creation <span className="text-red-400">*</span>
                </Label>
                <Input
                  type="date"
                  value={addCreatedAt}
                  onChange={(e) => setAddCreatedAt(e.target.value)}
                  className="bg-slate-900 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">Expiry Date</Label>
                <Input
                  type="date"
                  value={addRenewalDate}
                  readOnly
                  className="bg-slate-900/50 border-slate-600 text-slate-400 cursor-not-allowed"
                />
                <p className="text-[10px] text-slate-500">Auto-calculated: 6 months from creation</p>
              </div>
            </div>

            {/* Items Checkboxes */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">
                Items Given <span className="text-red-400">*</span>
              </Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                {(Object.keys(DEFAULT_ITEMS) as (keyof ItemsMap)[]).map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`add-item-${key}`}
                      checked={addItems[key]}
                      onCheckedChange={(checked) =>
                        setAddItems((prev) => ({ ...prev, [key]: !!checked }))
                      }
                      className="border-slate-600 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                    />
                    <label
                      htmlFor={`add-item-${key}`}
                      className="text-sm text-slate-300 cursor-pointer select-none"
                    >
                      {ITEM_ICONS[key]} {ITEM_LABELS[key]}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Site Selection */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Site</Label>
              <SiteCombobox
                sites={sites}
                selectedSite={addSite}
                onSelect={setAddSite}
              />
            </div>

            {/* Team Leader */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Team Leader</Label>
              <Input
                placeholder="Team leader name"
                value={addTeamLeader}
                onChange={(e) => setAddTeamLeader(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setAddDialogOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddNew}
              disabled={addSubmitting}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              {addSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                'Create Entry'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
