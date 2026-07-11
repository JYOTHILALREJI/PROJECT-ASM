'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Link2,
  Copy,
  ExternalLink,
  Building2,
  Calendar,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/* ───────── Types ───────── */

interface ShareEntry {
  id: string;
  token: string;
  date: string; // YYYY-MM-DD
  status: 'open' | 'submitted' | 'expired';
  submittedByName: string | null;
  createdAt: string;
  url: string;
}

interface SiteGroup {
  siteId: string;
  siteName: string;
  shares: ShareEntry[];
}

/* ───────── Helpers ───────── */

const STATUS_CONFIG: Record<ShareEntry['status'], { label: string; color: string; icon: React.ElementType }> = {
  open: { label: 'Open', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  expired: { label: 'Expired', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30', icon: XCircle },
};

function formatDateDisplay(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/* ───────── Main Component ───────── */

export function AttendanceCopyPage() {
  const [siteGroups, setSiteGroups] = useState<SiteGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsedSites, setCollapsedSites] = useState<Set<string>>(new Set());
  const [totalShares, setTotalShares] = useState(0);

  const fetchShares = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch('/api/attendance/share');
      const data = await res.json();
      if (data.success) {
        setSiteGroups(data.data.sites || []);
        setTotalShares(data.data.totalShares || 0);
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to load share links', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load share links', variant: 'destructive' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  // Auto-refresh every 30s so newly-generated links from the Attendance page
  // show up here without a manual refresh.
  useEffect(() => {
    const interval = setInterval(() => fetchShares(true), 30000);
    return () => clearInterval(interval);
  }, [fetchShares]);

  const handleCopyUrl = useCallback((url: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${origin}${url}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        toast({ title: 'Copied', description: 'Share link copied to clipboard' });
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = fullUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast({ title: 'Copied', description: 'Share link copied to clipboard' });
      });
    }
  }, []);

  // Filter by search (matches site name or date)
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return siteGroups;
    const q = search.toLowerCase();
    return siteGroups
      .map((g) => ({
        ...g,
        shares: g.shares.filter((s) => s.date.includes(q) || g.siteName.toLowerCase().includes(q)),
      }))
      .filter((g) => g.shares.length > 0);
  }, [siteGroups, search]);

  // Stats
  const stats = useMemo(() => {
    let open = 0;
    let submitted = 0;
    let expired = 0;
    for (const g of siteGroups) {
      for (const s of g.shares) {
        if (s.status === 'open') open++;
        else if (s.status === 'submitted') submitted++;
        else if (s.status === 'expired') expired++;
      }
    }
    return { open, submitted, expired, total: open + submitted + expired };
  }, [siteGroups]);

  const toggleSiteCollapse = useCallback((siteId: string) => {
    setCollapsedSites((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedSites(new Set(siteGroups.map((g) => g.siteId)));
  }, [siteGroups]);

  const expandAll = useCallback(() => {
    setCollapsedSites(new Set());
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
            <Link2 className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Attendance Copy</h2>
            <p className="text-slate-400 mt-0.5 text-sm">
              All shareable attendance links · grouped by site · click a date to open the sheet
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchShares()}
          disabled={refreshing}
          className="gap-2 border-slate-700 text-slate-300 hover:bg-slate-700"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Total Links</CardTitle>
              <Link2 className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-white">{stats.total}</p>
              <p className="text-xs text-slate-500 mt-0.5">across {siteGroups.length} site{siteGroups.length !== 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Open</CardTitle>
              <Clock className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-amber-400">{stats.open}</p>
              <p className="text-xs text-slate-500 mt-0.5">awaiting submission</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Submitted</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-emerald-400">{stats.submitted}</p>
              <p className="text-xs text-slate-500 mt-0.5">read-only</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Expired</CardTitle>
              <XCircle className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-slate-400">{stats.expired}</p>
              <p className="text-xs text-slate-500 mt-0.5">closed</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search + Expand/Collapse */}
      {!loading && siteGroups.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search by site name or date (YYYY-MM-DD)..."
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
      ) : siteGroups.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="py-16 text-center">
            <Link2 className="h-10 w-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-medium">No share links yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Go to the Attendance page, click <span className="text-amber-300">Share</span> on a site,
              pick a date, and generate a link. It will appear here automatically.
            </p>
          </CardContent>
        </Card>
      ) : filteredGroups.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="py-12 text-center">
            <Search className="h-8 w-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No links match &ldquo;{search}&rdquo;</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((group) => {
            const isCollapsed = collapsedSites.has(group.siteId);
            const openCount = group.shares.filter((s) => s.status === 'open').length;
            const submittedCount = group.shares.filter((s) => s.status === 'submitted').length;

            return (
              <Card key={group.siteId} className="bg-slate-800/50 border-slate-700/50 overflow-hidden">
                {/* Site header (clickable, no nested buttons) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSiteCollapse(group.siteId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSiteCollapse(group.siteId);
                    }
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-900/40 hover:bg-slate-900/60 transition-colors text-left border-b border-slate-700/50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-slate-400 shrink-0" />
                    )}
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 shrink-0">
                      <Building2 className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-white truncate block">{group.siteName}</span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        <Users className="h-2.5 w-2.5 inline mr-0.5" />
                        {group.shares.length} link{group.shares.length !== 1 ? 's' : ''}
                        <span className="mx-1.5">·</span>
                        <span className="text-amber-400">{openCount} open</span>
                        <span className="mx-1">·</span>
                        <span className="text-emerald-400">{submittedCount} submitted</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Shares list (collapsible) */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-700/30">
                    {group.shares.map((share) => {
                      const cfg = STATUS_CONFIG[share.status];
                      const StatusIcon = cfg.icon;
                      return (
                        <div
                          key={share.id}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-slate-700/20 transition-colors"
                        >
                          {/* Date */}
                          <div className="flex items-center gap-2 shrink-0 w-44">
                            <Calendar className="h-4 w-4 text-slate-500" />
                            <div className="min-w-0">
                              <p className="text-sm text-white font-medium truncate">
                                {formatDateDisplay(share.date)}
                              </p>
                              <p className="text-[10px] text-slate-500 font-mono">{share.date}</p>
                            </div>
                          </div>

                          <Separator orientation="vertical" className="h-8 bg-slate-700/50" />

                          {/* Status */}
                          <Badge className={cn('shrink-0 gap-1 text-[10px] px-2 py-0.5 h-5 border', cfg.color)}>
                            <StatusIcon className="h-3 w-3" />
                            {cfg.label}
                          </Badge>

                          {/* Submitter / created info */}
                          <div className="flex-1 min-w-0 hidden sm:block">
                            {share.submittedByName && (
                              <p className="text-xs text-slate-400 truncate">
                                by <span className="text-slate-300">{share.submittedByName}</span>
                              </p>
                            )}
                            <p className="text-[10px] text-slate-500">
                              Created {formatTimestamp(share.createdAt)}
                            </p>
                          </div>

                          {/* Actions (real buttons — no nesting) */}
                          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                            <a
                              href={share.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                                share.status === 'submitted'
                                  ? 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'
                                  : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-500/30',
                              )}
                              title={share.status === 'submitted' ? 'View read-only summary' : 'Open attendance sheet'}
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span className="hidden sm:inline">
                                {share.status === 'submitted' ? 'View' : 'Open'}
                              </span>
                            </a>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopyUrl(share.url)}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-slate-700"
                              title="Copy link"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
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
