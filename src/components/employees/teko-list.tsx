'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Ghost,
  Plus,
  Trash2,
  Pencil,
  Link2,
  Unlink,
  Loader2,
  User,
  Search,
  AlertTriangle,
  ArrowRight,
  Eye,
  Building2,
  Phone,
  Globe,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

interface TekoEntry {
  id: string;
  realName: string;
  workName: string;
  workEmployeeId: string;
  linkedEmployeeId: string | null;
  notes: string;
  cancelledAt: string;
  createdAt: string;
  updatedAt: string;
  linkedEmployee: {
    id: string;
    fullName: string;
    employeeId: string;
    status: string;
    currentSite: string | null;
    trade: string | null;
    photo: string | null;
    nationality: string | null;
    phone: string | null;
    isTeamLeader: boolean;
    isSupervisor: boolean;
  } | null;
  originalEmployee: {
    id: string;
    fullName: string;
    employeeId: string;
    nationality: string | null;
    phone: string | null;
    trade: string | null;
    currentSite: string | null;
    isTeamLeader: boolean;
    isSupervisor: boolean;
    status: string;
    photo: string | null;
    joinDate: string | null;
  } | null;
}

interface SearchEmployee {
  id: string;
  fullName: string;
  employeeId: string;
  nationality: string | null;
  currentSite: string | null;
  trade: string | null;
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function TekoList() {
  const { toast } = useToast();

  const [tekoList, setTekoList] = useState<TekoEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState<'add' | 'edit'>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    realName: '',
    workName: '',
    workEmployeeId: '',
    notes: '',
  });

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState<TekoEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Link employee dialog
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkingEntry, setLinkingEntry] = useState<TekoEntry | null>(null);

  // Compare (side-by-side) dialog
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [comparingEntry, setComparingEntry] = useState<TekoEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchEmployee[]>([]);
  const [searching, setSearching] = useState(false);

  const fetchTeko = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teko');
      const data = await res.json();
      if (data.success) {
        setTekoList(data.data.teko);
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to load teko list', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load teko list', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTeko();
  }, [fetchTeko]);

  // Search employees for linking
  useEffect(() => {
    if (!linkDialogOpen) return;
    const delay = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(`/api/employees?search=${encodeURIComponent(searchQuery)}&limit=10`);
        const data = await res.json();
        if (data.success) {
          setSearchResults(data.employees || []);
        }
      } catch {
        // silent
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(delay);
  }, [searchQuery, linkDialogOpen]);

  const openAddDialog = () => {
    setEditMode('add');
    setEditingId(null);
    setForm({ realName: '', workName: '', workEmployeeId: '', notes: '' });
    setDialogOpen(true);
  };

  const openEditDialog = (entry: TekoEntry) => {
    setEditMode('edit');
    setEditingId(entry.id);
    setForm({
      realName: entry.realName,
      workName: entry.workName,
      workEmployeeId: entry.workEmployeeId,
      notes: entry.notes,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.realName.trim() || !form.workName.trim() || !form.workEmployeeId.trim()) {
      toast({ title: 'Validation Error', description: 'Real name, work name, and work employee ID are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const url = editMode === 'add' ? '/api/teko' : `/api/teko/${editingId}`;
      const method = editMode === 'add' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: editMode === 'add' ? 'Teko Created' : 'Teko Updated',
          description: `${form.realName} → ${form.workName} (${form.workEmployeeId})`,
        });
        setDialogOpen(false);
        fetchTeko();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to save', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingEntry) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/teko/${deletingEntry.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Teko Deleted', description: `${deletingEntry.realName} has been removed.` });
        setDeleteDialogOpen(false);
        setDeletingEntry(null);
        fetchTeko();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to delete', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const openLinkDialog = (entry: TekoEntry) => {
    setLinkingEntry(entry);
    setSearchQuery('');
    setSearchResults([]);
    setLinkDialogOpen(true);
  };

  const handleLink = async (employeeId: string) => {
    if (!linkingEntry) return;
    try {
      const res = await fetch(`/api/teko/${linkingEntry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedEmployeeId: employeeId }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Employee Linked', description: `Employee has been linked to ${linkingEntry.workName}.` });
        setLinkDialogOpen(false);
        setLinkingEntry(null);
        fetchTeko();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to link', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to link employee', variant: 'destructive' });
    }
  };

  const handleUnlink = async (entry: TekoEntry) => {
    try {
      const res = await fetch(`/api/teko/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedEmployeeId: null }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Employee Unlinked', description: `Employee has been unlinked from ${entry.workName}.` });
        fetchTeko();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to unlink', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to unlink', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Ghost className="h-5 w-5 text-violet-400" />
            Teko Employees
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Cancelled employees whose identity (name + ID) is reused by another real employee
          </p>
        </div>
        <Button onClick={openAddDialog} size="sm" className="bg-violet-600 hover:bg-violet-700 text-white">
          <Plus className="h-4 w-4 mr-1.5" />
          Add Teko
        </Button>
      </div>

      {/* Teko List */}
      {tekoList.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-8 text-center">
            <Ghost className="h-10 w-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">No teko entries yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Cancel an employee or add a teko entry manually to map a real employee to a cancelled one's identity.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tekoList.map((entry) => (
            <Card key={entry.id} className="bg-slate-800/50 border-slate-700/50 hover:border-slate-600 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Real person → Work identity */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Real person */}
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-lg bg-emerald-500/15 flex items-center justify-center border border-emerald-500/25">
                        <span className="text-xs font-bold text-emerald-400">{getInitials(entry.realName)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{entry.realName}</p>
                        <p className="text-[10px] text-slate-500">Real Name</p>
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="flex items-center gap-1 text-slate-500">
                      <ArrowRight className="h-4 w-4" />
                    </div>

                    {/* Work identity */}
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-lg bg-violet-500/15 flex items-center justify-center border border-violet-500/25">
                        <Ghost className="h-4 w-4 text-violet-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{entry.workName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{entry.workEmployeeId}</p>
                      </div>
                    </div>
                  </div>

                  {/* Linked employee */}
                  <div className="flex items-center gap-2">
                    {entry.linkedEmployee ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px] px-2 py-1 gap-1">
                        <Link2 className="h-3 w-3" />
                        Linked: {entry.linkedEmployee.fullName}
                        {entry.linkedEmployee.employeeId && (
                          <span className="font-mono ml-0.5">({entry.linkedEmployee.employeeId})</span>
                        )}
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-600/20 text-slate-400 border-slate-600/30 text-[10px] px-2 py-1">
                        Not linked
                      </Badge>
                    )}
                  </div>

                  {/* Notes */}
                  {entry.notes && (
                    <p className="text-xs text-slate-500 italic max-w-[200px] truncate" title={entry.notes}>
                      "{entry.notes}"
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {entry.linkedEmployee ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleUnlink(entry)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                        title="Unlink employee"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openLinkDialog(entry)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                        title="Link to real employee"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setComparingEntry(entry); setCompareDialogOpen(true); }}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10"
                      title="Compare side by side"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditDialog(entry)}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setDeletingEntry(entry); setDeleteDialogOpen(true); }}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Cancelled date */}
                <p className="text-[10px] text-slate-600 mt-2">
                  Cancelled: {new Date(entry.cancelledAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">{editMode === 'add' ? 'Add Teko Entry' : 'Edit Teko Entry'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              Map a real employee to a cancelled employee's identity.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Real Name (actual person working) *</Label>
              <Input
                value={form.realName}
                onChange={(e) => setForm({ ...form, realName: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white h-9"
                placeholder="e.g. John Doe"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Work Name (cancelled employee's name) *</Label>
              <Input
                value={form.workName}
                onChange={(e) => setForm({ ...form, workName: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white h-9"
                placeholder="e.g. Ahmed Ali"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Work Employee ID (the ID still in use) *</Label>
              <Input
                value={form.workEmployeeId}
                onChange={(e) => setForm({ ...form, workEmployeeId: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white h-9 font-mono"
                placeholder="e.g. ASM-2025-001"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Notes (optional)</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white h-9"
                placeholder="e.g. Took over from Ahmed in July 2026"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700/50">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-slate-600 text-slate-300 hover:bg-slate-700">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editMode === 'add' ? 'Create' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Delete Teko Entry
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Delete the teko mapping for <strong className="text-white">{deletingEntry?.workName}</strong> ({deletingEntry?.workEmployeeId})?
              {deletingEntry?.linkedEmployee && (
                <span className="block mt-2 text-amber-400">
                  The linked employee ({deletingEntry.linkedEmployee.fullName}) will be unlinked but not affected.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-700/50">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} className="border-slate-600 text-slate-300 hover:bg-slate-700">
              Cancel
            </Button>
            <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link Employee Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={(open) => { if (!open) { setLinkDialogOpen(false); setLinkingEntry(null); } }}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Link Real Employee</DialogTitle>
            <DialogDescription className="text-slate-400">
              Search for the real employee who is using <strong className="text-white">{linkingEntry?.workName}</strong>'s identity ({linkingEntry?.workEmployeeId}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white h-9 pl-9"
                placeholder="Search by name or ID..."
                autoFocus
              />
            </div>
            <div className="max-h-[250px] overflow-y-auto space-y-1.5">
              {searching ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : searchQuery.trim() === '' ? (
                <p className="text-center text-xs text-slate-500 py-6">Start typing to search</p>
              ) : searchResults.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-6">No employees found</p>
              ) : (
                searchResults.map((emp) => (
                  <div
                    key={emp.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-900/50 border border-slate-700/50 hover:border-slate-600 transition-colors"
                  >
                    <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-blue-400">{getInitials(emp.fullName)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{emp.fullName}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{emp.employeeId}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleLink(emp.id)}
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Link2 className="h-3 w-3 mr-1" />
                      Link
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Compare (Side-by-Side) Dialog ── */}
      <Dialog open={compareDialogOpen} onOpenChange={(open) => { if (!open) { setCompareDialogOpen(false); setComparingEntry(null); } }}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Eye className="h-5 w-5 text-cyan-400" />
              Side-by-Side Comparison
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Work ID: <span className="font-mono text-slate-300">{comparingEntry?.workEmployeeId}</span>
            </DialogDescription>
          </DialogHeader>

          {comparingEntry && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
              {/* ── Original (cancelled) Employee ── */}
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-violet-500/20">
                  <Ghost className="h-5 w-5 text-violet-400" />
                  <div>
                    <p className="text-sm font-semibold text-white">Original (Cancelled)</p>
                    <p className="text-[10px] text-violet-400">The employee who left</p>
                  </div>
                </div>
                {comparingEntry.originalEmployee ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-12 w-12 rounded-lg bg-violet-500/20 flex items-center justify-center border border-violet-500/30">
                        {comparingEntry.originalEmployee.photo ? (
                          <img src={comparingEntry.originalEmployee.photo} alt="" className="h-full w-full rounded-lg object-cover" />
                        ) : (
                          <span className="text-sm font-bold text-violet-400">{getInitials(comparingEntry.originalEmployee.fullName)}</span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{comparingEntry.originalEmployee.fullName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{comparingEntry.originalEmployee.employeeId}</p>
                      </div>
                    </div>
                    <CompareRow icon={Globe} label="Nationality" value={comparingEntry.originalEmployee.nationality} />
                    <CompareRow icon={Phone} label="Phone" value={comparingEntry.originalEmployee.phone} />
                    <CompareRow icon={User} label="Trade" value={comparingEntry.originalEmployee.trade} />
                    <CompareRow icon={Building2} label="Site" value={comparingEntry.originalEmployee.currentSite} />
                    <CompareRow icon={User} label="Role" value={comparingEntry.originalEmployee.isTeamLeader ? 'Team Leader' : comparingEntry.originalEmployee.isSupervisor ? 'Supervisor' : 'Standard'} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No cancelled employee record found in the database.</p>
                )}
              </div>

              {/* ── Real (current) Employee ── */}
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-emerald-500/20">
                  <User className="h-5 w-5 text-emerald-400" />
                  <div>
                    <p className="text-sm font-semibold text-white">Real Employee (Current)</p>
                    <p className="text-[10px] text-emerald-400">The person now using this ID</p>
                  </div>
                </div>
                {comparingEntry.linkedEmployee ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-12 w-12 rounded-lg bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                        {comparingEntry.linkedEmployee.photo ? (
                          <img src={comparingEntry.linkedEmployee.photo} alt="" className="h-full w-full rounded-lg object-cover" />
                        ) : (
                          <span className="text-sm font-bold text-emerald-400">{getInitials(comparingEntry.linkedEmployee.fullName)}</span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{comparingEntry.linkedEmployee.fullName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{comparingEntry.linkedEmployee.employeeId}</p>
                      </div>
                    </div>
                    <CompareRow icon={User} label="Real Name" value={comparingEntry.realName} />
                    <CompareRow icon={Globe} label="Nationality" value={comparingEntry.linkedEmployee.nationality} />
                    <CompareRow icon={Phone} label="Phone" value={comparingEntry.linkedEmployee.phone} />
                    <CompareRow icon={User} label="Trade" value={comparingEntry.linkedEmployee.trade} />
                    <CompareRow icon={Building2} label="Site" value={comparingEntry.linkedEmployee.currentSite} />
                    <CompareRow icon={User} label="Role" value={comparingEntry.linkedEmployee.isTeamLeader ? 'Team Leader' : comparingEntry.linkedEmployee.isSupervisor ? 'Supervisor' : 'Standard'} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500 italic mb-2">Not linked to a real employee yet.</p>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-12 w-12 rounded-lg bg-slate-700/30 flex items-center justify-center border border-slate-600/30">
                        <span className="text-sm font-bold text-slate-500">{getInitials(comparingEntry.realName)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{comparingEntry.realName}</p>
                        <p className="text-[10px] text-slate-500">Real name (not yet linked)</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => { setCompareDialogOpen(false); setLinkingEntry(comparingEntry); setLinkDialogOpen(true); }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs"
                    >
                      <Link2 className="h-3 w-3 mr-1" />
                      Link Employee
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {comparingEntry?.notes && (
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50 mt-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Notes</p>
              <p className="text-xs text-slate-300 italic">"{comparingEntry.notes}"</p>
            </div>
          )}

          <div className="flex items-center justify-end pt-3 border-t border-slate-700/50">
            <Button variant="outline" onClick={() => setCompareDialogOpen(false)} className="border-slate-600 text-slate-300 hover:bg-slate-700">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Compare Row helper ──────────────────────────────────────────────────

function CompareRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-800/50">
      <Icon className="h-3 w-3 text-slate-500 flex-shrink-0" />
      <span className="text-[10px] uppercase tracking-wider text-slate-500 w-20 flex-shrink-0">{label}</span>
      <span className="text-xs text-slate-200 font-medium">{value && value.trim() ? value : '—'}</span>
    </div>
  );
}
