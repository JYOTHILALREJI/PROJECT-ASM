'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Tent,
  MapPin,
  BedDouble,
  Users,
  Plus,
  Loader2,
  Crown,
  ShieldCheck,
  Pencil,
  Trash2,
  User,
  Building2,
  Phone,
  Search,
  X,
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
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

interface CampDetail {
  id: string;
  name: string;
  location: string | null;
  totalBedSpaces: number;
  occupiedBedSpaces: number;
  availableBedSpaces: number;
  isActive: boolean;
}

interface CampEmployee {
  id: string;
  fullName: string;
  employeeId: string;
  nationality: string | null;
  trade: string | null;
  currentSite: string | null;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  role: string;
  status: string;
  phone: string | null;
  photo: string | null;
}

interface SearchEmployee {
  id: string;
  fullName: string;
  employeeId: string;
  nationality: string | null;
  currentSite: string | null;
  trade: string | null;
  campId: string | null;
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function CampDetailPage() {
  const { selectedEmployeeId, setCurrentView, setSelectedEmployeeId } = useAppStore();
  const campId = selectedEmployeeId; // campId is stored in selectedEmployeeId
  const { toast } = useToast();

  const [camp, setCamp] = useState<CampDetail | null>(null);
  const [employees, setEmployees] = useState<CampEmployee[]>([]);
  const [loading, setLoading] = useState(true);

  // Add employee dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchEmployee[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState<SearchEmployee | null>(null);

  const fetchCampData = useCallback(async () => {
    if (!campId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/camps/${campId}`);
      const data = await res.json();
      if (data.success) {
        setCamp(data.data.camp);
        setEmployees(data.data.employees);
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to load camp', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load camp', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [campId, toast]);

  useEffect(() => {
    fetchCampData();
  }, [fetchCampData]);

  // Search employees for assignment
  useEffect(() => {
    if (!addDialogOpen) return;
    const delay = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(`/api/employees?search=${encodeURIComponent(searchQuery)}&limit=20`);
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
  }, [searchQuery, addDialogOpen]);

  const handleAssign = async (employee: SearchEmployee, confirm = false) => {
    setAssigning(employee.id);
    try {
      const res = await fetch(`/api/camps/${campId}/assign-employee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee.id, confirmTransfer: confirm }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: 'Employee Assigned',
          description: `${employee.fullName} has been assigned to ${camp?.name}.`,
        });
        setConfirmTransfer(null);
        fetchCampData();
      } else if (data.needsConfirmation) {
        setConfirmTransfer(employee);
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to assign employee', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to assign employee', variant: 'destructive' });
    } finally {
      setAssigning(null);
    }
  };

  const handleRemoveEmployee = async (employeeId: string, employeeName: string) => {
    try {
      const res = await fetch(`/api/camps/${campId}/assign-employee?employeeId=${employeeId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Employee Removed', description: `${employeeName} has been removed from ${camp?.name}.` });
        fetchCampData();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to remove employee', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to remove employee', variant: 'destructive' });
    }
  };

  const viewEmployeeDetail = (employeeId: string) => {
    // Store the camp ID in localStorage so the back button returns to the camp
    if (campId) {
      localStorage.setItem('asm_camp_return_id', campId);
    }
    setSelectedEmployeeId(employeeId);
    setCurrentView('employee_detail');
  };

  const handleBack = () => {
    setSelectedEmployeeId(null);
    setCurrentView('camps');
  };

  // Pie chart data
  const pieData = useMemo(() => {
    if (!camp) return [];
    return [
      { name: 'Occupied', value: camp.occupiedBedSpaces, color: '#f59e0b' },
      { name: 'Available', value: camp.availableBedSpaces, color: '#10b981' },
    ].filter((d) => d.value > 0);
  }, [camp]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!camp) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto mb-3" />
          <p className="text-slate-400 mb-4">Camp not found</p>
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Camps
          </Button>
        </div>
      </div>
    );
  }

  const occupancyPct = camp.totalBedSpaces > 0
    ? Math.round((camp.occupiedBedSpaces / camp.totalBedSpaces) * 100)
    : 0;

  return (
    <div className="space-y-4 pb-8">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button
          variant="ghost"
          onClick={handleBack}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Camps
        </Button>
        <Button
          onClick={() => setAddDialogOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          disabled={camp.availableBedSpaces <= 0}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Employee to Camp
        </Button>
      </div>

      {/* Camp Header + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Camp Info */}
        <Card className="bg-gradient-to-br from-slate-800 to-slate-800/60 border-slate-700/50 lg:col-span-1">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-xl bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                <Tent className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{camp.name}</h1>
                {camp.location && (
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" />
                    {camp.location}
                  </p>
                )}
              </div>
            </div>
            {!camp.isActive && (
              <Badge className="bg-slate-600/20 text-slate-400 border-slate-600/30 text-[10px]">
                Inactive
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Total Bed Spaces</p>
              <p className="text-3xl font-bold text-white">{camp.totalBedSpaces}</p>
            </div>
            <BedDouble className="h-10 w-10 text-slate-600" />
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Occupied</p>
              <p className="text-3xl font-bold text-amber-400">{camp.occupiedBedSpaces}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{occupancyPct}% full</p>
            </div>
            <Users className="h-10 w-10 text-amber-500/30" />
          </CardContent>
        </Card>
      </div>

      {/* Pie Chart + Available */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Available</p>
              <p className="text-3xl font-bold text-emerald-400">{camp.availableBedSpaces}</p>
            </div>
            <BedDouble className="h-10 w-10 text-emerald-500/30" />
          </CardContent>
        </Card>

        {/* Pie Chart */}
        <Card className="bg-slate-800/50 border-slate-700/50 lg:col-span-2">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-slate-300 mb-4">Occupancy Breakdown</h3>
            {pieData.length > 0 ? (
              <div className="flex items-center gap-6">
                <div className="h-32 w-32 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={60}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2">
                  {pieData.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-sm text-slate-300">{entry.name}</span>
                      </div>
                      <span className="text-sm font-bold text-white">{entry.value}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
                    <span className="text-xs text-slate-500">Total Capacity</span>
                    <span className="text-sm font-bold text-white">{camp.totalBedSpaces}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                No bed spaces configured
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Employee List */}
      <Card className="bg-slate-800/50 border-slate-700/50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" />
              Employees in this Camp ({employees.length})
            </h3>
          </div>

          {employees.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">No employees assigned to this camp yet</p>
              <Button
                onClick={() => setAddDialogOpen(true)}
                size="sm"
                className="mt-3 bg-blue-600 hover:bg-blue-700 text-white"
                disabled={camp.availableBedSpaces <= 0}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Employee
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {employees.map((emp) => (
                <div
                  key={emp.id}
                  className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50 hover:border-slate-600 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <button
                      onClick={() => viewEmployeeDetail(emp.id)}
                      className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0 border border-blue-500/30 hover:bg-blue-500/30 transition-colors cursor-pointer"
                    >
                      {emp.photo ? (
                        <img src={emp.photo} alt={emp.fullName} className="h-full w-full rounded-lg object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-blue-400">{getInitials(emp.fullName)}</span>
                      )}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => viewEmployeeDetail(emp.id)}
                        className="text-sm font-medium text-white hover:text-blue-400 transition-colors text-left truncate block w-full"
                      >
                        {emp.fullName}
                      </button>
                      <p className="text-[10px] text-slate-500 font-mono">{emp.employeeId}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {emp.isTeamLeader && (
                          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[9px] px-1.5 py-0">
                            <Crown className="h-2.5 w-2.5 mr-0.5" />
                            TL
                          </Badge>
                        )}
                        {emp.isSupervisor && (
                          <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/25 text-[9px] px-1.5 py-0">
                            <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />
                            Sup
                          </Badge>
                        )}
                        {emp.trade && (
                          <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/25 text-[9px] px-1.5 py-0">
                            {emp.trade}
                          </Badge>
                        )}
                      </div>
                      {emp.currentSite && (
                        <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-0.5">
                          <Building2 className="h-2.5 w-2.5" />
                          {emp.currentSite}
                        </p>
                      )}
                    </div>

                    {/* Remove button */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveEmployee(emp.id, emp.fullName)}
                      className="h-7 w-7 p-0 text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from camp"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Employee Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Add Employee to {camp.name}</DialogTitle>
            <DialogDescription className="text-slate-400">
              Search for an employee and assign them to this camp.
              {camp.availableBedSpaces > 0 && (
                <span className="block mt-1 text-emerald-400">
                  {camp.availableBedSpaces} bed space(s) available.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white h-9 pl-9"
                placeholder="Search by name or employee ID..."
                autoFocus
              />
            </div>

            {/* Results */}
            <div className="max-h-[300px] overflow-y-auto space-y-1.5">
              {searching ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : searchQuery.trim() === '' ? (
                <p className="text-center text-xs text-slate-500 py-8">
                  Start typing to search for employees
                </p>
              ) : searchResults.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-8">
                  No employees found
                </p>
              ) : (
                searchResults.map((emp) => {
                  const isInThisCamp = emp.campId === campId;
                  const isInOtherCamp = emp.campId && emp.campId !== campId;
                  return (
                    <div
                      key={emp.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-900/50 border border-slate-700/50 hover:border-slate-600 transition-colors"
                    >
                      <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-blue-400">{getInitials(emp.fullName)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{emp.fullName}</p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span className="font-mono">{emp.employeeId}</span>
                          {emp.currentSite && <span>• {emp.currentSite}</span>}
                        </div>
                        {isInOtherCamp && (
                          <p className="text-[10px] text-amber-400 mt-0.5">
                            ⚠ Already in another camp — transfer required
                          </p>
                        )}
                      </div>
                      {isInThisCamp ? (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[9px]">
                          Assigned
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleAssign(emp)}
                          disabled={assigning === emp.id}
                          className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          {assigning === emp.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Assign'}
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Confirmation Dialog */}
      <Dialog open={!!confirmTransfer} onOpenChange={(open) => { if (!open) setConfirmTransfer(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Transfer Employee
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              <strong className="text-white">{confirmTransfer?.fullName}</strong> is already assigned to another camp.
              Transferring them will remove them from their current camp and assign them to <strong className="text-white">{camp.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-700/50">
            <Button variant="outline" onClick={() => setConfirmTransfer(null)} className="border-slate-600 text-slate-300 hover:bg-slate-700">
              Cancel
            </Button>
            <Button
              onClick={() => confirmTransfer && handleAssign(confirmTransfer, true)}
              disabled={assigning === confirmTransfer?.id}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {assigning === confirmTransfer?.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Transfer & Assign
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
