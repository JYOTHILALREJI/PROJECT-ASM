'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Tent,
  Plus,
  Pencil,
  Trash2,
  Eye,
  Loader2,
  MapPin,
  BedDouble,
  Users,
  AlertTriangle,
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
import { useAppStore } from '@/store/app-store';
import { useToast } from '@/hooks/use-toast';

interface Camp {
  id: string;
  name: string;
  location: string | null;
  totalBedSpaces: number;
  occupiedBedSpaces: number;
  availableBedSpaces: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function CampPage() {
  const { setCurrentView, setSelectedEmployeeId } = useAppStore();
  const { toast } = useToast();

  const [camps, setCamps] = useState<Camp[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState<'add' | 'edit'>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingCamp, setDeletingCamp] = useState<Camp | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({
    name: '',
    location: '',
    totalBedSpaces: '',
  });

  const fetchCamps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/camps');
      const data = await res.json();
      if (data.success) {
        setCamps(data.data.camps);
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to load camps', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load camps', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchCamps();
  }, [fetchCamps]);

  const openAddDialog = () => {
    setEditMode('add');
    setEditingId(null);
    setForm({ name: '', location: '', totalBedSpaces: '' });
    setDialogOpen(true);
  };

  const openEditDialog = (camp: Camp) => {
    setEditMode('edit');
    setEditingId(camp.id);
    setForm({
      name: camp.name,
      location: camp.location || '',
      totalBedSpaces: String(camp.totalBedSpaces),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Validation Error', description: 'Camp name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        location: form.location.trim(),
        totalBedSpaces: form.totalBedSpaces ? parseInt(form.totalBedSpaces, 10) : 0,
      };
      const url = editMode === 'add' ? '/api/camps' : `/api/camps/${editingId}`;
      const method = editMode === 'add' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: editMode === 'add' ? 'Camp Created' : 'Camp Updated',
          description: `${form.name} has been ${editMode === 'add' ? 'created' : 'updated'} successfully.`,
        });
        setDialogOpen(false);
        fetchCamps();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to save camp', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save camp', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingCamp) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/camps/${deletingCamp.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Camp Deleted', description: `${deletingCamp.name} has been removed.` });
        setDeleteDialogOpen(false);
        setDeletingCamp(null);
        fetchCamps();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to delete camp', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete camp', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const viewCamp = (camp: Camp) => {
    // Use selectedEmployeeId to carry the campId (same state slot)
    setSelectedEmployeeId(camp.id);
    setCurrentView('camp_detail');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Tent className="h-5 w-5 text-blue-400" />
            Camps
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Manage accommodation camps and their bed-space occupancy
          </p>
        </div>
        <Button onClick={openAddDialog} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-1.5" />
          Add Camp
        </Button>
      </div>

      {/* Camp Cards Grid */}
      {camps.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-12 text-center">
            <Tent className="h-12 w-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 mb-1">No camps yet</p>
            <p className="text-xs text-slate-500 mb-4">Add a camp to start managing employee accommodations</p>
            <Button onClick={openAddDialog} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="h-4 w-4 mr-1.5" />
              Add First Camp
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {camps.map((camp) => {
            const occupancyPct = camp.totalBedSpaces > 0
              ? Math.round((camp.occupiedBedSpaces / camp.totalBedSpaces) * 100)
              : 0;
            return (
              <Card key={camp.id} className="bg-slate-800/50 border-slate-700/50 hover:border-slate-600 transition-colors">
                <CardContent className="p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-white truncate">{camp.name}</h3>
                      {camp.location && (
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />
                          {camp.location}
                        </p>
                      )}
                    </div>
                    {!camp.isActive && (
                      <Badge className="bg-slate-600/20 text-slate-400 border-slate-600/30 text-[9px] px-1.5 py-0">
                        Inactive
                      </Badge>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-slate-900/50 rounded-lg p-2 text-center">
                      <BedDouble className="h-3.5 w-3.5 text-slate-400 mx-auto mb-1" />
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">Total</p>
                      <p className="text-sm font-bold text-white">{camp.totalBedSpaces}</p>
                    </div>
                    <div className="bg-amber-500/10 rounded-lg p-2 text-center">
                      <Users className="h-3.5 w-3.5 text-amber-400 mx-auto mb-1" />
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">Occupied</p>
                      <p className="text-sm font-bold text-amber-400">{camp.occupiedBedSpaces}</p>
                    </div>
                    <div className="bg-emerald-500/10 rounded-lg p-2 text-center">
                      <BedDouble className="h-3.5 w-3.5 text-emerald-400 mx-auto mb-1" />
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">Available</p>
                      <p className="text-sm font-bold text-emerald-400">{camp.availableBedSpaces}</p>
                    </div>
                  </div>

                  {/* Occupancy bar */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-slate-500">Occupancy</span>
                      <span className="text-[10px] text-slate-400 font-medium">{occupancyPct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          occupancyPct >= 90 ? 'bg-red-500' : occupancyPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${occupancyPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => viewCamp(camp)}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white h-8 text-xs"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      View Camp
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditDialog(camp)}
                      className="border-slate-600 text-slate-300 hover:bg-slate-700 h-8 w-8 p-0"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setDeletingCamp(camp); setDeleteDialogOpen(true); }}
                      className="border-slate-600 text-slate-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50 h-8 w-8 p-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">{editMode === 'add' ? 'Add New Camp' : 'Edit Camp'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {editMode === 'add' ? 'Create a new accommodation camp.' : 'Update camp information.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Camp Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white h-9"
                placeholder="e.g. Riyadh Camp 1"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Location</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white h-9"
                placeholder="e.g. Industrial Area, Riyadh"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Total Bed Spaces</Label>
              <Input
                type="number"
                min="0"
                value={form.totalBedSpaces}
                onChange={(e) => setForm({ ...form, totalBedSpaces: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white h-9"
                placeholder="e.g. 50"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700/50">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-slate-600 text-slate-300 hover:bg-slate-700">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editMode === 'add' ? 'Create Camp' : 'Save Changes'}
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
              Delete Camp
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete <strong className="text-white">{deletingCamp?.name}</strong>?
              {deletingCamp && deletingCamp.occupiedBedSpaces > 0 && (
                <span className="block mt-2 text-amber-400">
                  This camp has {deletingCamp.occupiedBedSpaces} employee(s) assigned. They will be unassigned from this camp.
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
    </div>
  );
}
