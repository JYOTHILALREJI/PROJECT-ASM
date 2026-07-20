'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Calendar,
  Building2,
  Users,
  Crown,
  ShieldCheck,
  Printer,
  Lock,
  AlertTriangle,
  Check,
  X,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/* ───────── Types ───────── */

interface ShareInfo {
  id: string;
  token: string;
  siteId: string;
  siteName: string;
  clientName: string | null;
  projectName: string | null;
  date: string;
  status: 'open' | 'submitted' | 'expired';
  submittedByName: string | null;
  submittedAt: string;
  createdAt: string;
  // When the link expires (end of the share's date, 23:59:59 local server
  // time). After this, the link is read-only even if not submitted.
  expiresAt?: string | null;
}

interface ShareEmployee {
  id: string;
  fullName: string;
  employeeId: string;
  trade: string | null;
  position: string | null;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  // The live DB attendance status for this employee on the share's date.
  // Used to pre-populate the Present/Absent selector so changes made via
  // the website (or another share link, or a version restore) are reflected
  // here — bidirectional sync.
  liveStatus?: 'present' | 'absent' | 'no_site' | 'overtime' | 'not_marked';
}

type Status = 'present' | 'absent' | 'unmarked';

/* ───────── Helpers ───────── */

function formatDateDisplay(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
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

export default function AttendanceSharePage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [employees, setEmployees] = useState<ShareEmployee[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitterName, setSubmitterName] = useState('');
  const [submitResult, setSubmitResult] = useState<{ succeeded: number; failed: number; total: number } | null>(null);

  // Resolve the token from params
  useEffect(() => {
    params.then((p) => setToken(p.token));
  }, [params]);

  // Fetch share data
  const fetchShare = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/attendance/share/${token}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to load share link');
        return;
      }
      setShare(data.data.share);
      setEmployees(data.data.employees || []);

      // If submitted, pre-populate statuses from the snapshot so the page
      // shows a read-only summary of what was marked.
      if (data.data.share.status === 'submitted' && data.data.submittedEntries) {
        const map: Record<string, Status> = {};
        for (const e of data.data.submittedEntries as Array<{ employeeId: string; status: string }>) {
          map[e.employeeId] = (e.status === 'present' || e.status === 'absent') ? e.status : 'unmarked';
        }
        setStatuses(map);
        setSubmitted(true);
      } else {
        // Open share: pre-populate from the LIVE DB attendance (bidirectional
        // sync). If an admin already marked someone present via the website,
        // the share page shows them as present. Otherwise default to 'unmarked'.
        const map: Record<string, Status> = {};
        for (const e of (data.data.employees || []) as ShareEmployee[]) {
          const live = e.liveStatus;
          if (live === 'present') map[e.id] = 'present';
          else if (live === 'absent') map[e.id] = 'absent';
          else map[e.id] = 'unmarked';
        }
        setStatuses(map);
      }
    } catch {
      setError('Failed to load share link');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchShare();
  }, [fetchShare]);

  const setStatus = useCallback((employeeId: string, status: Status) => {
    setStatuses((prev) => ({ ...prev, [employeeId]: status }));
  }, []);

  const markAll = useCallback((status: Status) => {
    setStatuses((prev) => {
      const next: Record<string, Status> = {};
      for (const e of employees) next[e.id] = status;
      return next;
    });
  }, [employees]);

  // Group employees by TL/Supervisor/Standard for display ordering
  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      const aRank = a.isTeamLeader ? 0 : a.isSupervisor ? 1 : 2;
      const bRank = b.isTeamLeader ? 0 : b.isSupervisor ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      return (a.fullName || '').localeCompare(b.fullName || '');
    });
  }, [employees]);

  const markedCount = useMemo(() => {
    let count = 0;
    for (const e of employees) {
      if (statuses[e.id] === 'present' || statuses[e.id] === 'absent') count++;
    }
    return count;
  }, [employees, statuses]);

  const presentCount = useMemo(() => {
    return Object.values(statuses).filter((s) => s === 'present').length;
  }, [statuses]);

  const absentCount = useMemo(() => {
    return Object.values(statuses).filter((s) => s === 'absent').length;
  }, [statuses]);

  // ── Local-time expiry ──
  // The server stores expiresAt as a UTC timestamp computed from the server's
  // local timezone. But the TL views the page in THEIR local timezone. If the
  // server is in UTC but the TL is in Asia/Calcutta (UTC+5:30), the server's
  // 23:59:59 UTC shows as 5:29:59 AM the next day in the TL's timezone —
  // confusing.
  //
  // Fix: compute the expiry in the CLIENT's local timezone based on the
  // share's date string (YYYY-MM-DD, no timezone). The share expires at
  // 23:59:59.999 on that calendar day in the TL's local timezone. This is
  // what the TL's clock shows, so "expires at 11:59 PM tonight" is accurate.
  //
  // We also do a client-side expiry check: if the current local time is past
  // the local end-of-day AND the share is still 'open', treat it as expired
  // (override the server status). The server's check is a fallback.
  //
  // MUST be declared before handleSubmit (which uses isLocallyExpired).
  const localExpiresAt = useMemo(() => {
    if (!share?.date) return null;
    const [yr, mo, dy] = share.date.split('-').map(Number);
    // new Date(yr, mo-1, dy, 23, 59, 59, 999) is in the browser's local TZ
    return new Date(yr, mo - 1, dy, 23, 59, 59, 999);
  }, [share?.date]);

  const isLocallyExpired = useMemo(() => {
    if (!localExpiresAt) return false;
    return new Date() > localExpiresAt;
  }, [localExpiresAt]);

  // Effective status: if the server says 'open' but the client's local time
  // is past the local end-of-day, treat as expired.
  const effectiveStatus = share
    ? (share.status === 'open' && isLocallyExpired ? 'expired' : share.status)
    : 'expired';

  const handleSubmit = useCallback(async () => {
    if (!share) return;
    // Client-side expiry check: if the link has expired (local time past
    // end-of-day), block submission immediately without hitting the server.
    // The server also checks, but this gives instant feedback.
    if (isLocallyExpired) {
      alert('This share link has expired. Attendance can only be submitted on the same day the link was created for. Please request a new link from the admin.');
      return;
    }
    if (markedCount === 0) {
      alert('Please mark at least one employee as present or absent before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const entries = employees
        .map((e) => ({ employeeId: e.id, status: statuses[e.id] as 'present' | 'absent' }))
        .filter((e) => e.status === 'present' || e.status === 'absent');

      const res = await fetch(`/api/attendance/share/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries,
          submittedByName: submitterName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
        setSubmitResult({
          succeeded: data.data.attendance.succeeded,
          failed: data.data.attendance.failed,
          total: data.data.attendance.total,
        });
        // Refresh the share so the status badge updates
        await fetchShare();
      } else {
        if (data.alreadySubmitted) {
          setSubmitted(true);
          await fetchShare();
        } else {
          alert(data.error || 'Failed to submit attendance');
        }
      }
    } catch {
      alert('Failed to submit attendance. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }, [share, employees, statuses, markedCount, token, submitterName, fetchShare, isLocallyExpired]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  /* ───────── Render ───────── */

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          <p className="text-sm text-slate-500">Loading attendance sheet...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 mx-auto mb-4">
            <XCircle className="h-7 w-7 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Not Available</h1>
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-sm text-slate-500">No share data</p>
      </div>
    );
  }

  const isReadOnly = effectiveStatus !== 'open' || submitted;

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Print-only styles */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-container { padding: 0 !important; }
          .print-sheet { box-shadow: none !important; border: none !important; margin: 0 !important; max-width: 100% !important; }
        }
      `}</style>

      {/* Top bar */}
      <div className="no-print bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo_asm.png" alt="ASM" className="h-9 w-auto" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-gray-900 truncate">Arabian Shield Manpower</h1>
              <p className="text-[11px] text-gray-500 truncate">Daily Attendance Sheet</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isReadOnly && (
              <Button onClick={handlePrint} variant="outline" size="sm" className="gap-1.5">
                <Printer className="h-3.5 w-3.5" />
                Print
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 print-container">
        {/* Status banner */}
        {isReadOnly && (
          <div className={cn(
            'no-print rounded-lg border p-4 mb-4 flex items-start gap-3',
            effectiveStatus === 'submitted'
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-amber-50 border-amber-200',
          )}>
            {effectiveStatus === 'submitted' ? (
              <Lock className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                {effectiveStatus === 'submitted' ? 'Attendance already submitted' : 'This link has expired'}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {effectiveStatus === 'submitted' ? (
                  <>
                    Submitted{share.submittedByName ? ` by ${share.submittedByName}` : ''} on{' '}
                    {formatTimestamp(share.submittedAt)}. The link is now read-only — entries below
                    are shown as recorded and cannot be edited.
                    {submitResult && (
                      <span className="block mt-1.5 text-emerald-700">
                        {submitResult.succeeded} of {submitResult.total} record(s) saved successfully.
                        {submitResult.failed > 0 ? ` ${submitResult.failed} failed.` : ''}
                      </span>
                    )}
                  </>
                ) : (
                  'This share link has expired. Attendance can only be submitted on the same day the link was created for. Please request a new link from the admin.'
                )}
              </p>
            </div>
          </div>
        )}

        {/* Same-day expiry notice for OPEN shares — warns the TL that the
            link dies at end of day if not submitted. Uses the CLIENT's
            local timezone (not the server's) so the shown time matches the
            TL's clock. */}
        {!isReadOnly && localExpiresAt && (
          <div className="no-print rounded-lg border border-blue-200 bg-blue-50 p-3 mb-4 flex items-start gap-2">
            <Clock className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-blue-900">
                <span className="font-semibold">Same-day link:</span> this
                link expires at <span className="font-mono font-semibold">
                  {localExpiresAt.toLocaleString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>. If you don&apos;t submit by then, the link becomes
                read-only and the admin must generate a new one.
              </p>
            </div>
          </div>
        )}

        {/* Sheet (mimics the admin attendance sheet) */}
        <div className="print-sheet bg-white shadow-xl border border-gray-300 w-full p-[10mm]" style={{ boxSizing: 'border-box' }}>
          {/* Header */}
          <div className="relative border border-black bg-gray-200 px-3 py-2 flex items-center justify-between" style={{ minHeight: '52px' }}>
            <div className="flex-1" />
            <div className="flex-1 text-center">
              <h1 className="text-[16px] font-bold text-black tracking-[0.08em] uppercase">
                Arabian Shield Manpower
              </h1>
              <div className="mt-1.5 text-center py-1.5 text-[13px] font-bold tracking-[0.15em] uppercase bg-gray-400 text-black">
                Daily Attendance
              </div>
            </div>
            <div className="flex-1 flex justify-end items-center">
              <img src="/logo_asm.png" alt="ASM Logo" className="h-12 w-auto object-contain" />
            </div>
          </div>

          {/* Info Section */}
          <div className="mt-4 text-[12px] uppercase">
            <div className="flex items-baseline mb-1.5">
              <span className="font-bold text-gray-900 w-36 shrink-0">&#8226; Client Name :</span>
              <span className="flex-1 border-b border-gray-500 font-bold text-gray-800 px-1">
                {(share.clientName || share.siteName || '-').toUpperCase()}
              </span>
            </div>
            <div className="flex items-baseline mb-1.5">
              <span className="font-bold text-gray-900 w-36 shrink-0">&#8226; Project Name :</span>
              <span className="flex-1 border-b border-gray-500 font-bold text-gray-800 px-1">
                {(share.projectName || share.siteName || '-').toUpperCase()}
              </span>
            </div>
            <div className="flex items-baseline mb-1.5">
              <span className="font-bold text-gray-900 w-36 shrink-0">&#8226; Site :</span>
              <span className="flex-1 border-b border-gray-500 font-bold text-gray-800 px-1">
                {share.siteName.toUpperCase()}
              </span>
            </div>
            <div className="flex items-baseline mb-1.5">
              <span className="font-bold text-gray-900 w-36 shrink-0">&#8226; Date :</span>
              <span className="flex-1 border-b border-gray-500 font-bold text-gray-800 px-1">
                {formatDateDisplay(share.date).toUpperCase()}
              </span>
            </div>
            <div className="flex items-baseline mb-1.5">
              <span className="font-bold text-gray-900 w-36 shrink-0">&#8226; Strength :</span>
              <span className="flex-1 border-b border-gray-500 font-bold text-gray-800 px-1">
                {employees.length} EMPLOYEES
              </span>
            </div>
          </div>

          {/* Summary chips (only when not yet submitted, or after) */}
          <div className="no-print mt-4 flex flex-wrap gap-2">
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {presentCount} Present
            </Badge>
            <Badge className="bg-red-100 text-red-700 border-red-200">
              <XCircle className="h-3 w-3 mr-1" />
              {absentCount} Absent
            </Badge>
            <Badge className="bg-slate-100 text-slate-600 border-slate-200">
              <Users className="h-3 w-3 mr-1" />
              {markedCount} of {employees.length} marked
            </Badge>
          </div>

          {/* Bulk action buttons (only when open) */}
          {!isReadOnly && (
            <div className="no-print mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => markAll('present')} className="gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                Mark all present
              </Button>
              <Button size="sm" variant="outline" onClick={() => markAll('absent')} className="gap-1.5">
                <X className="h-3.5 w-3.5 text-red-600" />
                Mark all absent
              </Button>
              <Button size="sm" variant="ghost" onClick={() => markAll('unmarked')} className="gap-1.5 text-slate-500">
                Reset all
              </Button>
            </div>
          )}

          {/* Main Employee Table */}
          <div className="mt-4 pb-2">
            <table className="w-full border-collapse text-[13px] uppercase">
              <thead>
                <tr className="bg-gray-400 text-black">
                  <th className="border border-black px-2 py-2 text-center font-bold w-12 text-[14px]">Sl. No</th>
                  <th className="border border-black px-2 py-2 text-left font-bold text-[14px]">Name</th>
                  <th className="border border-black px-2 py-2 text-center font-bold w-[115px] text-[14px]">Emp. Code</th>
                  <th className="border border-black px-2 py-2 text-left font-bold w-[179px] text-[14px]">Trade</th>
                  <th className="border border-black px-2 py-2 text-center font-bold w-48 text-[14px]">
                    {isReadOnly ? 'Status' : 'Mark Present / Absent'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="border border-black px-2 py-8 text-center text-gray-500 text-[13px]">
                      No active employees assigned to this site.
                    </td>
                  </tr>
                ) : (
                  sortedEmployees.map((emp, idx) => {
                    const status = statuses[emp.id] || 'unmarked';
                    const isEven = idx % 2 === 1;
                    return (
                      <tr
                        key={emp.id}
                        className={cn(
                          isEven ? 'bg-gray-50' : 'bg-white',
                          emp.isTeamLeader && 'bg-amber-50',
                          emp.isSupervisor && !emp.isTeamLeader && 'bg-blue-50',
                        )}
                      >
                        <td className="border border-black px-2 py-1.5 text-center text-gray-700 font-bold">
                          {idx + 1}
                        </td>
                        <td className="border border-black px-2 py-1 text-gray-900 font-bold">
                          <div className="flex items-center gap-1.5">
                            <span>{emp.fullName.toUpperCase()}</span>
                            {emp.isTeamLeader && (
                              <Crown className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                            {emp.isSupervisor && !emp.isTeamLeader && (
                              <ShieldCheck className="h-3 w-3 text-blue-500 shrink-0" />
                            )}
                          </div>
                        </td>
                        <td className="border border-black px-2 py-1 text-center text-gray-700 font-mono font-bold">
                          {emp.employeeId.toUpperCase()}
                        </td>
                        <td className="border border-black px-2 py-1 text-gray-700 font-bold">
                          {emp.trade?.toUpperCase() || emp.position?.toUpperCase() || '-'}
                          {emp.isTeamLeader && ' / TL'}
                          {emp.isSupervisor && !emp.isTeamLeader && ' / SUPERVISOR'}
                        </td>
                        <td className="border border-black px-2 py-1.5 text-center">
                          {isReadOnly ? (
                            // Read-only status badge
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase',
                              status === 'present' && 'bg-emerald-100 text-emerald-700',
                              status === 'absent' && 'bg-red-100 text-red-700',
                              status === 'unmarked' && 'bg-slate-100 text-slate-500',
                            )}>
                              {status === 'present' && <Check className="h-3 w-3" />}
                              {status === 'absent' && <X className="h-3 w-3" />}
                              {status === 'unmarked' ? '—' : status}
                            </span>
                          ) : (
                            // Interactive Present/Absent selector
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setStatus(emp.id, 'present')}
                                className={cn(
                                  'inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold uppercase border transition-colors',
                                  status === 'present'
                                    ? 'bg-emerald-500 text-white border-emerald-500'
                                    : 'bg-white text-emerald-600 border-emerald-300 hover:bg-emerald-50',
                                )}
                              >
                                <Check className="h-3 w-3" />
                                P
                              </button>
                              <button
                                type="button"
                                onClick={() => setStatus(emp.id, 'absent')}
                                className={cn(
                                  'inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold uppercase border transition-colors',
                                  status === 'absent'
                                    ? 'bg-red-500 text-white border-red-500'
                                    : 'bg-white text-red-600 border-red-300 hover:bg-red-50',
                                )}
                              >
                                <X className="h-3 w-3" />
                                A
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="mt-6 flex items-end justify-between text-[11px] text-gray-500 uppercase">
            <div>
              <p>Generated: {formatTimestamp(share.createdAt)}</p>
              {share.status === 'submitted' && (
                <p>Submitted: {formatTimestamp(share.submittedAt)}</p>
              )}
            </div>
            <div className="text-right">
              <p>Token: {share.token.substring(0, 8)}...</p>
            </div>
          </div>
        </div>

        {/* Submit section (only when open) */}
        {!isReadOnly && (
          <div className="no-print mt-4 bg-white rounded-xl shadow-md border border-gray-200 p-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase tracking-wide block mb-1.5">
                Your name (optional)
              </label>
              <Input
                type="text"
                value={submitterName}
                onChange={(e) => setSubmitterName(e.target.value)}
                placeholder="e.g. John Doe (Team Leader)"
                className="h-9"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Recorded for audit purposes. You can leave this blank.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-600">
                {markedCount} of {employees.length} employees marked.{' '}
                {markedCount === employees.length ? (
                  <span className="text-emerald-600 font-medium">Ready to submit.</span>
                ) : (
                  <span className="text-amber-600">
                    {employees.length - markedCount} unmarked will be skipped.
                  </span>
                )}
              </p>
              <Button
                onClick={handleSubmit}
                disabled={submitting || markedCount === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Submit Attendance
                  </>
                )}
              </Button>
            </div>
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              Once submitted, this link becomes read-only and cannot be edited. Verify all entries before clicking Submit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
