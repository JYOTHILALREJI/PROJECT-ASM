'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  History,
  Search,
  X,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  User,
  Crown,
  Shield,
  Globe,
  Calendar,
  Filter,
  Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/* ───────── Types ───────── */

interface LogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  description: string;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface UserLogGroup {
  userId: string | null;
  displayName: string;
  userEmail: string | null;
  actorType: string;
  logCount: number;
  lastActivityAt: string;
  logs: LogEntry[];
}

/* ───────── Helpers ───────── */

const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  login: { label: 'Login', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  logout: { label: 'Logout', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  mark_attendance: { label: 'Mark Attendance', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  bulk_mark: { label: 'Bulk Mark', color: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  share_link_submit: { label: 'Share Submit', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  create: { label: 'Create', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  update: { label: 'Update', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  delete: { label: 'Delete', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  advance_create: { label: 'Advance Create', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  salary_bulk_save: { label: 'Salary Save', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
};

const ENTITY_ICONS: Record<string, React.ElementType> = {
  user: User,
  attendance: Calendar,
  attendance_share: Globe,
  site: Filter,
  employee: User,
  advance: History,
  salary_record: History,
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/* ───────── Main Component ───────── */

export function AllLogsPage() {
  const [userGroups, setUserGroups] = useState<UserLogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [collapsedUsers, setCollapsedUsers] = useState<Set<string>>(new Set());
  const [totalLogs, setTotalLogs] = useState(0);

  const fetchLogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch('/api/activity-logs?groupByUser=true&limit=1000');
      const data = await res.json();
      if (data.success) {
        setUserGroups(data.data.users || []);
        setTotalLogs(data.data.totalLogs || 0);
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to load logs', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load logs', variant: 'destructive' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchLogs(true), 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Apply search + filters
  const filteredGroups = useMemo(() => {
    let groups = userGroups;
    if (search.trim()) {
      const q = search.toLowerCase();
      groups = groups.map((g) => ({
        ...g,
        logs: g.logs.filter(
          (l) =>
            l.description.toLowerCase().includes(q) ||
            (l.entityName || '').toLowerCase().includes(q) ||
            g.displayName.toLowerCase().includes(q) ||
            (g.userEmail || '').toLowerCase().includes(q) ||
            l.action.toLowerCase().includes(q) ||
            l.entityType.toLowerCase().includes(q)
        ),
      })).filter((g) => g.logs.length > 0);
    }
    if (actionFilter !== 'all') {
      groups = groups.map((g) => ({
        ...g,
        logs: g.logs.filter((l) => l.action === actionFilter),
      })).filter((g) => g.logs.length > 0);
    }
    if (entityFilter !== 'all') {
      groups = groups.map((g) => ({
        ...g,
        logs: g.logs.filter((l) => l.entityType === entityFilter),
      })).filter((g) => g.logs.length > 0);
    }
    return groups;
  }, [userGroups, search, actionFilter, entityFilter]);

  const stats = useMemo(() => {
    let totalActions = 0;
    const actionTypes = new Set<string>();
    const entityTypes = new Set<string>();
    for (const g of userGroups) {
      totalActions += g.logCount;
      for (const l of g.logs) {
        actionTypes.add(l.action);
        entityTypes.add(l.entityType);
      }
    }
    return {
      totalUsers: userGroups.length,
      totalActions,
      actionTypes: actionTypes.size,
      entityTypes: entityTypes.size,
    };
  }, [userGroups]);

  // Collect unique actions + entity types for the filter dropdowns
  const availableActions = useMemo(() => {
    const set = new Set<string>();
    for (const g of userGroups) for (const l of g.logs) set.add(l.action);
    return Array.from(set).sort();
  }, [userGroups]);

  const availableEntityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const g of userGroups) for (const l of g.logs) set.add(l.entityType);
    return Array.from(set).sort();
  }, [userGroups]);

  const toggleUserCollapse = useCallback((key: string) => {
    setCollapsedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedUsers(new Set(filteredGroups.map((g) => g.userId || '__system__')));
  }, [filteredGroups]);

  const expandAll = useCallback(() => {
    setCollapsedUsers(new Set());
  }, []);

  const handleExportCsv = useCallback(() => {
    // Export the filtered logs as CSV
    const rows: string[] = ['User,Email,Action,Entity Type,Entity Name,Description,IP Address,Timestamp'];
    for (const g of filteredGroups) {
      for (const l of g.logs) {
        const cells = [
          `"${g.displayName.replace(/"/g, '""')}"`,
          `"${(g.userEmail || '').replace(/"/g, '""')}"`,
          l.action,
          l.entityType,
          `"${(l.entityName || '').replace(/"/g, '""')}"`,
          `"${l.description.replace(/"/g, '""')}"`,
          l.ipAddress || '',
          l.createdAt,
        ];
        rows.push(cells.join(','));
      }
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast({ title: 'Exported', description: `${rows.length - 1} log(s) exported as CSV` });
  }, [filteredGroups]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
            <History className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">All Logs</h2>
            <p className="text-slate-400 mt-0.5 text-sm">
              Audit trail of every action by every account holder · grouped by user
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={loading || filteredGroups.length === 0}
            className="gap-2 border-slate-700 text-slate-300 hover:bg-slate-700"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchLogs()}
            disabled={refreshing}
            className="gap-2 border-slate-700 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Account Holders</CardTitle>
              <User className="h-4 w-4 text-violet-400" />
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-white">{stats.totalUsers}</p>
              <p className="text-xs text-slate-500 mt-0.5">with activity</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Total Actions</CardTitle>
              <History className="h-4 w-4 text-blue-400" />
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-white">{stats.totalActions}</p>
              <p className="text-xs text-slate-500 mt-0.5">all time</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Action Types</CardTitle>
              <Filter className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-white">{stats.actionTypes}</p>
              <p className="text-xs text-slate-500 mt-0.5">distinct</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Entity Types</CardTitle>
              <Globe className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-white">{stats.entityTypes}</p>
              <p className="text-xs text-slate-500 mt-0.5">distinct</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search + Filters */}
      {!loading && userGroups.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search by user, action, description, entity..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-slate-900 border-slate-600 text-white placeholder:text-slate-500"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-slate-500 hover:text-white"
                onClick={() => setSearch('')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[160px] bg-slate-800 border-slate-700 text-sm text-white h-9">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="all" className="text-white focus:bg-slate-700">All actions</SelectItem>
              {availableActions.map((a) => (
                <SelectItem key={a} value={a} className="text-white focus:bg-slate-700">{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-[160px] bg-slate-800 border-slate-700 text-sm text-white h-9">
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="all" className="text-white focus:bg-slate-700">All entities</SelectItem>
              {availableEntityTypes.map((e) => (
                <SelectItem key={e} value={e} className="text-white focus:bg-slate-700">{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <Button variant="ghost" size="sm" onClick={expandAll} className="text-slate-400 hover:text-white text-xs h-7">
              Expand All
            </Button>
            <Button variant="ghost" size="sm" onClick={collapseAll} className="text-slate-400 hover:text-white text-xs h-7">
              Collapse All
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 bg-slate-800 rounded-lg" />
          ))}
        </div>
      ) : userGroups.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="py-16 text-center">
            <History className="h-10 w-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-medium">No activity logs yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Activity is logged automatically as users interact with the app. Log in, mark attendance,
              create sites, save salary records — every action will appear here.
            </p>
          </CardContent>
        </Card>
      ) : filteredGroups.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="py-12 text-center">
            <Search className="h-8 w-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No logs match your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((group) => {
            const key = group.userId || '__system__';
            const isCollapsed = collapsedUsers.has(key);
            const isSystem = group.actorType === 'system' || !group.userId;
            return (
              <Card key={key} className="bg-slate-800/50 border-slate-700/50 overflow-hidden">
                {/* User header (clickable, no nested buttons) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleUserCollapse(key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleUserCollapse(key);
                    }
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-900/40 hover:bg-slate-900/60 transition-colors text-left border-b border-slate-700/50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-slate-400 shrink-0" />
                    )}
                    <div className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full shrink-0',
                      isSystem ? 'bg-slate-600/20' : 'bg-violet-500/10',
                    )}>
                      {isSystem ? (
                        <Globe className="h-4 w-4 text-slate-400" />
                      ) : (
                        <span className="text-sm font-semibold text-violet-400">
                          {group.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">{group.displayName}</span>
                        {isSystem && (
                          <Badge className="bg-slate-600/20 text-slate-400 border-slate-500/30 text-[9px] px-1.5 py-0 h-4">
                            System
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {group.userEmail && !isSystem && (
                          <span className="text-[11px] text-slate-500 truncate">
                            {group.userEmail}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-500">
                          {group.logCount} action{group.logCount !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[11px] text-slate-500">·</span>
                        <span className="text-[11px] text-slate-500">
                          Last: {formatTimestamp(group.lastActivityAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Logs table (collapsible) */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700/50 hover:bg-transparent">
                          <TableHead className="text-slate-400 font-semibold text-xs uppercase tracking-wide w-32">Date</TableHead>
                          <TableHead className="text-slate-400 font-semibold text-xs uppercase tracking-wide w-24">Time</TableHead>
                          <TableHead className="text-slate-400 font-semibold text-xs uppercase tracking-wide w-32">Action</TableHead>
                          <TableHead className="text-slate-400 font-semibold text-xs uppercase tracking-wide w-32">Entity</TableHead>
                          <TableHead className="text-slate-400 font-semibold text-xs uppercase tracking-wide">Description</TableHead>
                          <TableHead className="text-slate-400 font-semibold text-xs uppercase tracking-wide w-32">IP Address</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.logs.map((log) => {
                          const cfg = ACTION_CONFIG[log.action] || { label: log.action, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
                          const EntityIcon = ENTITY_ICONS[log.entityType] || History;
                          return (
                            <TableRow key={log.id} className="border-slate-700/30 hover:bg-slate-700/20">
                              <TableCell className="text-slate-300 text-xs font-mono">
                                {formatDate(log.createdAt)}
                              </TableCell>
                              <TableCell className="text-slate-400 text-xs font-mono">
                                {formatTime(log.createdAt)}
                              </TableCell>
                              <TableCell>
                                <Badge className={cn('text-[10px] px-1.5 py-0 h-4 border', cfg.color)}>
                                  {cfg.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <EntityIcon className="h-3 w-3 text-slate-500 shrink-0" />
                                  <span className="text-xs text-slate-400">{log.entityType}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-slate-200 text-xs">
                                {log.description}
                                {log.entityName && (
                                  <span className="text-slate-500 ml-1">· {log.entityName}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-slate-500 text-xs font-mono">
                                {log.ipAddress || '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
