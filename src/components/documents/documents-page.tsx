'use client';

/**
 * DocumentsPage — Documents module:
 *   Dashboard · NOC (paginated list + client folders + create workspace) ·
 *   Employee Documents (paginated employee directory) · Settings (template /
 *   companies / stamps, super-admin).
 *
 * NOCs open in a DEDICATED PAGE (NocViewPage via the app store) with a back
 * button, print + download, and post-issue stamp toggle / stamp choice.
 * Fine-grained permissions: documents_noc, documents_employee_docs,
 * documents_delete (super_admin bypasses everything).
 */
import React from 'react';
import {
  FileText,
  FolderOpen,
  Plus,
  Eye,
  FileCheck2,
  CalendarDays,
  Pencil,
  LayoutDashboard,
  Settings2,
  Upload,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { NocWorkspace, type NocEditSource } from '@/components/documents/noc-workspace';
import { NocList, NocFolderView } from '@/components/documents/noc-list';
import { NocSettings } from '@/components/documents/noc-settings';
import { EmployeeDocsDirectory } from '@/components/documents/employee-docs-directory';
import type { CompanyOption, NocLightRow, NocTemplateData, StampOption } from '@/components/documents/shared';

// ---------------------------------------------------------------------------

interface DashboardStats {
  totalFinal: number;
  thisMonth: number;
  drafts: number;
  employeesWithDocuments: number;
}

/** Fetch the current admin's document permissions. */
function useDocumentPermissions(): { canNoc: boolean; canEmployeeDocs: boolean; canDelete: boolean; loaded: boolean } {
  const { user } = useAuthStore();
  const [perms, setPerms] = React.useState({ canNoc: false, canEmployeeDocs: false, canDelete: false, loaded: false });
  React.useEffect(() => {
    if (!user) return;
    if (user.role === 'super_admin') {
      const t = setTimeout(() => setPerms({ canNoc: true, canEmployeeDocs: true, canDelete: true, loaded: true }), 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/permissions?adminId=${user.id}`);
        const data = await res.json();
        if (!cancelled && data.success) {
          const granted = new Set((data.data.permissions || []).filter((p: { granted?: boolean }) => p.granted).map((p: { slug: string }) => p.slug));
          setPerms({
            canNoc: granted.has('documents_noc'),
            canEmployeeDocs: granted.has('documents_employee_docs'),
            canDelete: granted.has('documents_delete'),
            loaded: true,
          });
        }
      } catch {
        if (!cancelled) setPerms((p) => ({ ...p, loaded: true }));
      }
    };
    const t = setTimeout(load, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [user]);
  return perms;
}

// ---------------------------------------------------------------------------
// DocumentsDashboard — summary cards, quick actions, recent NOCs
// ---------------------------------------------------------------------------

function DocumentsDashboard({
  stats,
  recent,
  loading,
  onCreate,
  onEmployeeDocs,
  onViewNoc,
}: {
  stats: DashboardStats | null;
  recent: NocLightRow[];
  loading: boolean;
  onCreate: () => void;
  onEmployeeDocs: () => void;
  onViewNoc: (nocId: string) => void;
}) {
  const cards = [
    { label: 'Total NOCs', value: loading ? '…' : stats?.totalFinal ?? 0, icon: FileCheck2, accent: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
    { label: 'This Month', value: loading ? '…' : stats?.thisMonth ?? 0, icon: CalendarDays, accent: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
    { label: 'Draft NOCs', value: loading ? '…' : stats?.drafts ?? 0, icon: Pencil, accent: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
    { label: 'Employees With Documents', value: loading ? '…' : stats?.employeesWithDocuments ?? 0, icon: FolderOpen, accent: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/30' },
  ];

  return (
    <div className="space-y-5">
      <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-3" stagger={0.06}>
        {cards.map((c) => (
          <StaggerItem key={c.label}>
            <div className={cn('rounded-xl border p-4', c.bg)}>
              <div className="flex items-center justify-between">
                <c.icon className={cn('h-5 w-5', c.accent)} />
              </div>
              <div className="mt-2 text-2xl font-bold text-white">{c.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{c.label}</div>
            </div>
          </StaggerItem>
        ))}
      </StaggerContainer>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onCreate} className="bg-blue-600 hover:bg-blue-500 text-white">
          <Plus className="h-4 w-4 mr-2" /> Create NOC
        </Button>
        <Button variant="outline" onClick={onEmployeeDocs} className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">
          <Upload className="h-4 w-4 mr-2" /> Employee Documents
        </Button>
      </div>

      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50">
          <FileText className="h-4 w-4 text-red-400" />
          <h3 className="text-sm font-semibold text-white">Recent Documents</h3>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No finalized NOCs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-semibold">Document</th>
                  <th className="px-3 py-2 font-semibold">Client</th>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold text-center">Employees</th>
                  <th className="px-3 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((noc) => (
                  <tr key={noc.id} className="border-t border-slate-700/40 hover:bg-slate-700/20">
                    <td className="px-4 py-2 text-[13px] font-medium text-slate-200">{noc.nocNumber}</td>
                    <td className="px-3 py-2 text-[13px] text-slate-300">{noc.clientName}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{noc.projectName || '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{noc.nocDate}</td>
                    <td className="px-3 py-2 text-xs text-slate-300 text-center">{noc.employeeCount}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-300 hover:bg-slate-700 hover:text-white" onClick={() => onViewNoc(noc.id)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocumentsPage — tabs + permission gating
// ---------------------------------------------------------------------------

type TabId = 'dashboard' | 'noc' | 'employee' | 'template';

export function DocumentsPage() {
  const perms = useDocumentPermissions();
  const { user } = useAuthStore();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSelectedNocId = useAppStore((s) => s.setSelectedNocId);
  const [tab, setTab] = React.useState<TabId>('dashboard');
  const [nocMode, setNocMode] = React.useState<'list' | 'create'>('list');
  const [editNoc, setEditNoc] = React.useState<NocEditSource | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const [stats, setStats] = React.useState<DashboardStats | null>(null);
  const [recent, setRecent] = React.useState<NocLightRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [template, setTemplate] = React.useState<NocTemplateData | null>(null);
  const [companies, setCompanies] = React.useState<CompanyOption[]>([]);
  const [stamps, setStamps] = React.useState<StampOption[]>([]);

  const loadDashboard = React.useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, recentRes] = await Promise.all([
        fetch('/api/documents/noc?view=stats'),
        fetch('/api/documents/noc?view=recent&limit=6'),
      ]);
      const statsData = await statsRes.json();
      const recentData = await recentRes.json();
      if (statsData.success) setStats(statsData.data);
      if (recentData.success) setRecent(recentData.data.nocs || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTemplate = React.useCallback(async () => {
    try {
      const res = await fetch('/api/documents/noc-template');
      const data = await res.json();
      if (data.success) setTemplate(data.data.template);
    } catch {
      // silent
    }
  }, []);

  const loadLibraries = React.useCallback(async () => {
    try {
      const [cRes, sRes] = await Promise.all([
        fetch('/api/documents/companies'),
        fetch('/api/documents/stamps'),
      ]);
      const cData = await cRes.json();
      const sData = await sRes.json();
      if (cData.success) setCompanies(cData.data.companies || []);
      if (sData.success) setStamps(sData.data.stamps || []);
    } catch {
      // silent
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => { loadDashboard(); loadTemplate(); loadLibraries(); }, 0);
    return () => clearTimeout(t);
  }, [loadDashboard, loadTemplate, loadLibraries]);

  const refreshAll = () => {
    setRefreshKey((k) => k + 1);
    loadDashboard();
  };

  const openNocPage = (nocId: string) => {
    setSelectedNocId(nocId);
    setCurrentView('noc_view');
  };

  const openCreate = () => { setEditNoc(null); setNocMode('create'); setTab('noc'); };

  const tabs: Array<{ id: TabId; label: string; icon: React.ElementType; locked?: boolean }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'noc', label: 'NOC', icon: FileCheck2, locked: !perms.canNoc },
    { id: 'employee', label: 'Employee Documents', icon: FolderOpen, locked: !perms.canEmployeeDocs },
    ...(user?.role === 'super_admin' ? [{ id: 'template' as TabId, label: 'NOC Settings', icon: Settings2 }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-bold text-white">Documents</h1>
          <p className="text-sm text-slate-400 mt-0.5">Manage NOCs, employee documents and company records.</p>
        </div>
      </FadeIn>

      <div className="flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon, locked }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors border',
              tab === id ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200 hover:bg-slate-700/40',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {locked && <Lock className="h-3 w-3 text-slate-500" />}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <FadeIn>
          <DocumentsDashboard
            stats={stats}
            recent={recent}
            loading={loading}
            onCreate={openCreate}
            onEmployeeDocs={() => setTab('employee')}
            onViewNoc={openNocPage}
          />
        </FadeIn>
      )}

      {tab === 'noc' && (
        perms.canNoc ? (
          nocMode === 'create' ? (
            <NocWorkspace
              editNoc={editNoc}
              companies={companies}
              stamps={stamps}
              onClose={() => { setNocMode('list'); setEditNoc(null); refreshAll(); }}
              onSaved={refreshAll}
              onOpenNoc={openNocPage}
            />
          ) : (
            <div className="space-y-5">
              <NocList
                canDelete={perms.canDelete}
                onCreate={openCreate}
                onEdit={(noc) => { setEditNoc(noc); setNocMode('create'); }}
                onViewNoc={openNocPage}
                onChanged={refreshAll}
                refreshKey={refreshKey}
              />
              <NocFolderView canDelete={perms.canDelete} onViewNoc={openNocPage} onChanged={refreshAll} refreshKey={refreshKey} />
            </div>
          )
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center">
            <Lock className="h-8 w-8 text-slate-500 mx-auto mb-3" />
            <p className="text-sm text-slate-400">You do not have permission to access NOCs. Ask a Super Admin to grant <span className="text-slate-200">Documents — NOC</span> in Admin Management.</p>
          </div>
        )
      )}

      {tab === 'employee' && (
        perms.canEmployeeDocs ? (
          <FadeIn>
            <EmployeeDocsDirectory refreshKey={refreshKey} />
          </FadeIn>
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center">
            <Lock className="h-8 w-8 text-slate-500 mx-auto mb-3" />
            <p className="text-sm text-slate-400">You do not have permission to access employee documents. Ask a Super Admin to grant <span className="text-slate-200">Documents — Employee Documents</span> in Admin Management.</p>
          </div>
        )
      )}

      {tab === 'template' && user?.role === 'super_admin' && (
        <FadeIn>
          <NocSettings
            template={template}
            companies={companies}
            stamps={stamps}
            onTemplateSaved={loadTemplate}
            onLibraryChanged={() => { loadLibraries(); refreshAll(); }}
          />
        </FadeIn>
      )}
    </div>
  );
}
