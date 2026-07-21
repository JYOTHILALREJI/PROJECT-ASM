'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  UserCog,
  Search,
  Mail,
  Lock,
  Crown,
  Users,
  Building2,
  Calendar,
  Bell,
  FileText,
  Ban,
  KeyRound,
  LayoutDashboard,
  Shirt,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  DollarSign,
  Calculator,
  Clock,
  History,
  Link2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';
import Swal from 'sweetalert2';

// SweetAlert2 dark theme config
const swalDarkConfig = {
  background: '#1e293b',
  color: '#e2e8f0',
  confirmButtonColor: '#3b82f6',
  cancelButtonColor: '#64748b',
  customClass: {
    popup: 'border border-slate-700',
    title: 'text-white',
    htmlContainer: 'text-slate-300',
  },
};

// Helper for SweetAlert2 success toast
function swalSuccess(title: string, text?: string) {
  return Swal.fire({
    ...swalDarkConfig,
    icon: 'success',
    title,
    text: text || '',
    timer: 2500,
    timerProgressBar: true,
    showConfirmButton: false,
    toast: true,
    position: 'top-end',
  });
}

// Helper for SweetAlert2 error toast
function swalError(title: string, text?: string) {
  return Swal.fire({
    ...swalDarkConfig,
    icon: 'error',
    title,
    text: text || '',
    timer: 3500,
    timerProgressBar: true,
    showConfirmButton: false,
    toast: true,
    position: 'top-end',
  });
}

// Helper for SweetAlert2 confirmation
function swalConfirm(title: string, text: string, confirmText = 'Yes', cancelText = 'Cancel') {
  return Swal.fire({
    ...swalDarkConfig,
    icon: 'warning',
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    reverseButtons: true,
  });
}

interface Admin {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

interface AdminFormData {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'super_admin';
}

const emptyForm: AdminFormData = {
  name: '',
  email: '',
  password: '',
  role: 'admin',
};

// Sidebar menu definitions with icons - mirrors the sidebar exactly
// Each entry corresponds to a permission toggle in the admin management page.
// Items that share a permission slug (e.g. Employee Hours shares 'employees')
// are listed as sub-items so the admin understands what's included.
const SIDEBAR_MENUS = [
  { slug: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'general', alwaysVisible: true },
  { slug: 'employees', label: 'Employees', icon: Users, group: 'workforce', alwaysVisible: false },
  { slug: 'sites', label: 'Sites', icon: Building2, group: 'workforce', alwaysVisible: false },
  { slug: 'attendance', label: 'Attendance', icon: Calendar, group: 'workforce', alwaysVisible: false },
  { slug: 'attendance_copy', label: 'Attendance Copy', icon: Link2, group: 'workforce', alwaysVisible: false },
  { slug: 'accounts', label: 'Accounts', icon: DollarSign, group: 'finance', alwaysVisible: false },
  { slug: 'consolidated_salary', label: 'Consolidated Salary', icon: Calculator, group: 'finance', alwaysVisible: false },
  { slug: 'employee_hours', label: 'Employee Hours', icon: Clock, group: 'finance', alwaysVisible: false },
  { slug: 'uniform_registry', label: 'Materials Registry', icon: Shirt, group: 'workforce', alwaysVisible: false },
  { slug: 'leave_requests', label: 'Leave Requests', icon: FileText, group: 'workforce', alwaysVisible: false },
  { slug: 'cancellation_requests', label: 'Cancellations', icon: Ban, group: 'workforce', alwaysVisible: false },
  { slug: 'notifications', label: 'Notifications', icon: Bell, group: 'general', alwaysVisible: false },
  { slug: 'admins', label: 'Admin Management + All Logs', icon: Shield, group: 'admin', alwaysVisible: false },
] as const;

interface PermissionItem {
  id: string;
  name: string;
  slug: string;
  group: string;
  granted?: boolean;
  isAlwaysVisible?: boolean;
}

// Permission group config for styling
const GROUP_CONFIG: Record<string, { label: string; color: string; borderColor: string; bgClass: string }> = {
  general: { label: 'General', color: 'text-slate-400', borderColor: 'border-slate-600/50', bgClass: 'bg-slate-500/10' },
  workforce: { label: 'Workforce', color: 'text-emerald-400', borderColor: 'border-emerald-600/50', bgClass: 'bg-emerald-500/10' },
  finance: { label: 'Finance', color: 'text-cyan-400', borderColor: 'border-cyan-600/50', bgClass: 'bg-cyan-500/10' },
  admin: { label: 'Administration', color: 'text-amber-400', borderColor: 'border-amber-600/50', bgClass: 'bg-amber-500/10' },
};

export function AdminPage() {
  const { user } = useAuthStore();

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);
  const [formData, setFormData] = useState<AdminFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingAdmin, setDeletingAdmin] = useState<Admin | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Inline permissions state: per admin, track expanded + permissions data
  const [expandedAdminId, setExpandedAdminId] = useState<string | null>(null);
  const [adminPermissionsMap, setAdminPermissionsMap] = useState<Record<string, Record<string, boolean>>>({});
  const [adminAllPermsMap, setAdminAllPermsMap] = useState<Record<string, PermissionItem[]>>({});
  const [permissionsLoading, setPermissionsLoading] = useState<string | null>(null);

  // Admin access map for display in table
  const [adminAccessMap, setAdminAccessMap] = useState<Record<string, string[]>>({});

  // Online admin IDs (lastSeenAt within 90s). Refreshed every 20s.
  const [onlineAdminIds, setOnlineAdminIds] = useState<Set<string>>(new Set());

  // Fetch online presence
  useEffect(() => {
    let cancelled = false;
    const fetchOnline = async () => {
      try {
        const res = await fetch('/api/presence/online');
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setOnlineAdminIds(new Set(data.data.onlineUserIds || []));
        }
      } catch {
        // silent
      }
    };
    fetchOnline();
    const interval = setInterval(fetchOnline, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Fetch admins
  const fetchAdmins = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admins');
      const json = await res.json();
      if (json.success) {
        const adminsList: Admin[] = json.data.admins || [];
        setAdmins(adminsList);
        // Fetch permissions for each regular admin
        const regularAdmins = adminsList.filter((a: Admin) => a.role === 'admin');
        const accessMap: Record<string, string[]> = {};
        const permsMap: Record<string, Record<string, boolean>> = {};
        const allPermsMap: Record<string, PermissionItem[]> = {};
        await Promise.all(
          regularAdmins.map(async (admin: Admin) => {
            try {
              const permRes = await fetch(`/api/permissions?adminId=${admin.id}`);
              const permJson = await permRes.json();
              if (permJson.success) {
                const perms: PermissionItem[] = permJson.data.permissions || [];
                const allowedLabels = perms
                  .filter((p: PermissionItem) => p.granted || p.isAlwaysVisible)
                  .map((p: PermissionItem) => p.name);
                accessMap[admin.id] = allowedLabels;
                allPermsMap[admin.id] = perms;
                const permRecord: Record<string, boolean> = {};
                perms.forEach((p: PermissionItem) => { permRecord[p.slug] = p.granted ?? false; });
                permsMap[admin.id] = permRecord;
              } else {
                accessMap[admin.id] = ['Dashboard', 'Uniform Registry'];
              }
            } catch {
              accessMap[admin.id] = ['Dashboard', 'Uniform Registry'];
            }
          })
        );
        setAdminAccessMap(accessMap);
        setAdminPermissionsMap(permsMap);
        setAdminAllPermsMap(allPermsMap);
      } else {
        setAdmins([]);
      }
    } catch {
      setAdmins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'super_admin') {
      fetchAdmins();
    }
  }, [user, fetchAdmins]);

  // Guard: only super_admin can access
  if (user?.role !== 'super_admin') {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 mb-4">
            <Shield className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Access Denied</h2>
          <p className="text-slate-400 mt-2 max-w-md">
            You do not have permission to access this page. Only super admins can manage admin accounts.
          </p>
        </div>
      </div>
    );
  }

  // Filter admins by search
  const filteredAdmins = admins.filter((admin) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      admin.name.toLowerCase().includes(q) ||
      admin.email.toLowerCase().includes(q) ||
      admin.role.toLowerCase().includes(q)
    );
  });

  // Separate super admins and regular admins
  const superAdmins = filteredAdmins.filter(a => a.role === 'super_admin');
  const regularAdmins = filteredAdmins.filter(a => a.role === 'admin');

  // Validate form
  function validateForm(data: AdminFormData, isEdit: boolean): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!data.name.trim()) {
      errors.name = 'Name is required';
    }
    if (!data.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.email = 'Invalid email format';
    }
    if (!isEdit && !data.password.trim()) {
      errors.password = 'Password is required';
    } else if (data.password && data.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }
    return errors;
  }

  // Open create dialog
  function handleCreate(defaultRole: 'admin' | 'super_admin' = 'admin') {
    setEditingAdmin(null);
    setFormData({ ...emptyForm, role: defaultRole });
    setFormErrors({});
    setDialogOpen(true);
  }

  // Open edit dialog
  function handleEdit(admin: Admin) {
    setEditingAdmin(admin);
    setFormData({ name: admin.name, email: admin.email, password: '', role: admin.role as 'admin' | 'super_admin' });
    setFormErrors({});
    setDialogOpen(true);
  }

  // Submit create/edit
  async function handleSubmit() {
    const isEdit = !!editingAdmin;
    const errors = validateForm(formData, isEdit);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // Warn about creating super admin
    if (!isEdit && formData.role === 'super_admin') {
      const result = await swalConfirm(
        'Create Super Admin?',
        'This user will have full system access including the ability to manage other admins.',
        'Yes, Create',
      );
      if (!result.isConfirmed) return;
    }

    // Warn about changing role to super_admin
    if (isEdit && editingAdmin!.role !== 'super_admin' && formData.role === 'super_admin') {
      const result = await swalConfirm(
        'Promote to Super Admin?',
        'They will gain full system access.',
        'Yes, Promote',
      );
      if (!result.isConfirmed) return;
    }

    // Warn about demoting super_admin
    if (isEdit && editingAdmin!.role === 'super_admin' && formData.role !== 'super_admin') {
      const otherSuperAdmins = admins.filter(a => a.role === 'super_admin' && a.id !== editingAdmin!.id);
      if (otherSuperAdmins.length === 0) {
        swalError('Cannot Demote', 'There must be at least one Super Admin in the system.');
        return;
      }
      const result = await swalConfirm(
        'Demote Super Admin?',
        'They will lose their elevated privileges.',
        'Yes, Demote',
      );
      if (!result.isConfirmed) return;
    }

    setSubmitting(true);
    try {
      let res: Response;
      if (isEdit) {
        const body: Record<string, string> = { name: formData.name, email: formData.email, role: formData.role };
        if (formData.password.trim()) body.password = formData.password;
        res = await fetch(`/api/admins/${editingAdmin.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/admins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, requesterId: user?.id }),
        });
      }
      const json = await res.json();

      if (json.success) {
        swalSuccess(
          isEdit ? 'Account Updated' : 'Account Created',
          `${formData.name} has been ${isEdit ? 'updated' : 'created'} as ${formData.role === 'super_admin' ? 'Super Admin' : 'Admin'} successfully.`,
        );
        setDialogOpen(false);
        fetchAdmins();
      } else {
        swalError('Error', json.error || 'Something went wrong');
      }
    } catch {
      swalError('Error', 'Failed to connect to the server');
    } finally {
      setSubmitting(false);
    }
  }

  // Open delete dialog
  function handleDelete(admin: Admin) {
    if (admin.role === 'super_admin') {
      const otherSuperAdmins = admins.filter(a => a.role === 'super_admin' && a.id !== admin.id);
      if (otherSuperAdmins.length === 0) {
        swalError('Cannot Delete', 'There must be at least one Super Admin in the system. Promote another user first.');
        return;
      }
    }
    setDeletingAdmin(admin);
    setDeleteDialogOpen(true);
  }

  // Confirm delete
  async function confirmDelete() {
    if (!deletingAdmin) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admins/${deletingAdmin.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        swalSuccess('Account Deleted', `${deletingAdmin.name} has been removed successfully.`);
        setDeleteDialogOpen(false);
        setDeletingAdmin(null);
        fetchAdmins();
      } else {
        swalError('Error', json.error || 'Failed to delete account');
      }
    } catch {
      swalError('Error', 'Failed to connect to the server');
    } finally {
      setDeleting(false);
    }
  }

  // Toggle expand for inline permissions
  async function toggleExpand(adminId: string) {
    if (expandedAdminId === adminId) {
      setExpandedAdminId(null);
      return;
    }
    setExpandedAdminId(adminId);
    // If we don't have permissions for this admin yet, fetch them
    if (!adminPermissionsMap[adminId] || !adminAllPermsMap[adminId]) {
      setPermissionsLoading(adminId);
      try {
        const res = await fetch(`/api/permissions?adminId=${adminId}`);
        const json = await res.json();
        if (json.success) {
          const perms: PermissionItem[] = json.data.permissions || [];
          const permRecord: Record<string, boolean> = {};
          perms.forEach((p: PermissionItem) => { permRecord[p.slug] = p.granted ?? false; });
          setAdminPermissionsMap(prev => ({ ...prev, [adminId]: permRecord }));
          setAdminAllPermsMap(prev => ({ ...prev, [adminId]: perms }));
        }
      } catch {
        // silent
      } finally {
        setPermissionsLoading(null);
      }
    }
  }

  // Toggle a single permission for an admin (inline)
  async function togglePermission(adminId: string, permissionSlug: string, granted: boolean) {
    // Optimistic update
    setAdminPermissionsMap(prev => ({
      ...prev,
      [adminId]: { ...prev[adminId], [permissionSlug]: granted },
    }));
    try {
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId, permissionSlug, granted }),
      });
      const json = await res.json();
      if (!json.success) {
        // Revert
        setAdminPermissionsMap(prev => ({
          ...prev,
          [adminId]: { ...prev[adminId], [permissionSlug]: !granted },
        }));
        swalError('Error', json.error || 'Failed to update permission');
        return;
      }
      // Update the access map display
      fetchAdmins();
      // SweetAlert2 toast for permission change
      const menuLabel = SIDEBAR_MENUS.find(m => m.slug === permissionSlug)?.label || permissionSlug;
      if (granted) {
        swalSuccess('Access Granted', `"${menuLabel}" menu is now visible to this admin.`);
      } else {
        Swal.fire({
          ...swalDarkConfig,
          icon: 'info',
          title: 'Access Revoked',
          text: `"${menuLabel}" menu is now hidden from this admin.`,
          timer: 2500,
          timerProgressBar: true,
          showConfirmButton: false,
          toast: true,
          position: 'top-end',
        });
      }
    } catch {
      setAdminPermissionsMap(prev => ({
        ...prev,
        [adminId]: { ...prev[adminId], [permissionSlug]: !granted },
      }));
      swalError('Error', 'Failed to update permission');
    }
  }

  // Grant all / Revoke all for a specific admin
  async function toggleAllPermissions(adminId: string, grant: boolean) {
    const perms = adminAllPermsMap[adminId] || [];
    const prev = { ...adminPermissionsMap[adminId] };
    const updates: Record<string, boolean> = {};
    perms.forEach(p => {
      if (!p.isAlwaysVisible) {
        updates[p.slug] = grant;
      }
    });
    setAdminPermissionsMap(prevState => ({
      ...prevState,
      [adminId]: { ...prevState[adminId], ...updates },
    }));
    try {
      const slugs = grant
        ? perms.filter(p => !p.isAlwaysVisible).map(p => p.slug)
        : [];
      await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId, permissionSlugs: slugs }),
      });
      fetchAdmins();
      if (grant) {
        swalSuccess('All Access Granted', 'All sidebar menus are now visible to this admin.');
      } else {
        Swal.fire({
          ...swalDarkConfig,
          icon: 'info',
          title: 'All Access Revoked',
          text: 'Only default menus are now visible to this admin.',
          timer: 2500,
          timerProgressBar: true,
          showConfirmButton: false,
          toast: true,
          position: 'top-end',
        });
      }
    } catch {
      setAdminPermissionsMap(prevState => ({
        ...prevState,
        [adminId]: prev,
      }));
      swalError('Error', 'Failed to update permissions');
    }
  }

  // Toggle all in a group for a specific admin
  async function toggleGroupPermissions(adminId: string, group: string, grant: boolean) {
    const perms = adminAllPermsMap[adminId] || [];
    const groupPerms = perms.filter(p => p.group === group && !p.isAlwaysVisible);
    const prev = { ...adminPermissionsMap[adminId] };
    const updates: Record<string, boolean> = {};
    groupPerms.forEach(p => { updates[p.slug] = grant; });
    setAdminPermissionsMap(prevState => ({
      ...prevState,
      [adminId]: { ...prevState[adminId], ...updates },
    }));
    try {
      await Promise.all(
        groupPerms.map(p =>
          fetch('/api/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminId, permissionSlug: p.slug, granted: grant }),
          })
        )
      );
      fetchAdmins();
      const gc = GROUP_CONFIG[group] || GROUP_CONFIG.general;
      if (grant) {
        swalSuccess(`${gc.label} Access Granted`, `All ${gc.label.toLowerCase()} menus are now visible.`);
      } else {
        Swal.fire({
          ...swalDarkConfig,
          icon: 'info',
          title: `${gc.label} Access Revoked`,
          text: `All ${gc.label.toLowerCase()} menus are now hidden.`,
          timer: 2500,
          timerProgressBar: true,
          showConfirmButton: false,
          toast: true,
          position: 'top-end',
        });
      }
    } catch {
      const reverts: Record<string, boolean> = {};
      groupPerms.forEach(p => { reverts[p.slug] = !grant; });
      setAdminPermissionsMap(prevState => ({
        ...prevState,
        [adminId]: { ...prevState[adminId], ...reverts },
      }));
      swalError('Error', 'Failed to update permissions');
    }
  }

  function formatDate(dateStr: string) {
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

  // Get icon for a permission slug
  function getMenuIcon(slug: string) {
    const menu = SIDEBAR_MENUS.find(m => m.slug === slug);
    return menu?.icon || Shield;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Admin Management</h2>
          <p className="text-slate-400 mt-1">
            Create and manage admin accounts. Control which sidebar menus each admin can access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20">
            <Crown className="h-3 w-3 mr-1" />
            Super Admin
          </Badge>
          <Button
            onClick={() => handleCreate('super_admin')}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Crown className="h-4 w-4 mr-2" />
            Create Super Admin
          </Button>
          <Button
            onClick={() => handleCreate('admin')}
            className="bg-blue-500 hover:bg-blue-600 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Admin
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search admins..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-blue-500/30 focus:border-blue-500/50"
        />
      </div>

      {/* Super Admins Section */}
      {superAdmins.length > 0 && (
        <Card className="bg-slate-800/50 border-amber-500/20 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Crown className="h-4 w-4 text-amber-400" />
              Super Admins
              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 ml-2">
                {superAdmins.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="overflow-x-auto rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400 font-semibold">Name</TableHead>
                    <TableHead className="text-slate-400 font-semibold">Email</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-center">Role</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-center">Access</TableHead>
                    <TableHead className="text-slate-400 font-semibold">Created</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {superAdmins.map((admin) => {
                    const isOnline = onlineAdminIds.has(admin.id);
                    return (
                    <TableRow key={admin.id} className="border-slate-700/50 hover:bg-slate-700/30">
                      <TableCell className="text-slate-200 font-medium">
                        <div className="flex items-center gap-2">
                          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10">
                            <Crown className="h-4 w-4 text-amber-400" />
                            {isOnline && (
                              <span
                                className="absolute -bottom-0 -right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-slate-800"
                                title="Online now"
                              />
                            )}
                          </div>
                          <div className="flex flex-col">
                            {admin.name}
                            {isOnline && (
                              <span className="text-[10px] text-emerald-400 font-medium">Online</span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 text-slate-500" />
                          {admin.email}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">
                          Super Admin
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
                          Full Access
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-400 text-sm">
                        {formatDate(admin.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(admin)}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(admin)}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Regular Admins Section */}
      <Card className="bg-slate-800/50 border-slate-700/50 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <UserCog className="h-4 w-4 text-slate-400" />
            Admin Directory
            <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 ml-2">
              {regularAdmins.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full bg-slate-700 rounded-lg" />
              ))}
            </div>
          ) : regularAdmins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-700/50 mb-4">
                <Shield className="h-7 w-7 text-slate-500" />
              </div>
              <p className="text-sm font-medium text-slate-400">
                {searchQuery ? 'No admins match your search' : 'No regular admins found'}
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                {searchQuery
                  ? 'Try a different search term.'
                  : 'Click "Create Admin" to add your first admin account.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {regularAdmins.map((admin) => {
                const isExpanded = expandedAdminId === admin.id;
                const perms = adminAllPermsMap[admin.id] || [];
                const permState = adminPermissionsMap[admin.id] || {};
                const isLoading = permissionsLoading === admin.id;
                const grantedCount = Object.values(permState).filter(Boolean).length;
                const totalConfigurable = perms.filter(p => !p.isAlwaysVisible).length;
                const grantedConfigurable = perms.filter(p => !p.isAlwaysVisible && permState[p.slug]).length;
                const isOnline = onlineAdminIds.has(admin.id);

                return (
                  <div
                    key={admin.id}
                    className={cn(
                      'rounded-xl border transition-all duration-200',
                      isExpanded
                        ? 'border-blue-500/30 bg-slate-800/80 shadow-lg shadow-blue-500/5'
                        : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600/50'
                    )}
                  >
                    {/* Admin Row Header */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                      onClick={() => toggleExpand(admin.id)}
                    >
                      {/* Avatar with online indicator */}
                      <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 shrink-0">
                        <span className="text-sm font-semibold text-blue-400">
                          {admin.name.charAt(0).toUpperCase()}
                        </span>
                        {isOnline && (
                          <span
                            className="absolute -bottom-0 -right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-slate-800"
                            title="Online now"
                          />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">{admin.name}</span>
                          <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 text-[10px] px-1.5 py-0 h-4">
                            Admin
                          </Badge>
                          {isOnline && (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 text-[10px] px-1.5 py-0 h-4 gap-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Online
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Mail className="h-3 w-3 text-slate-500" />
                          <span className="text-xs text-slate-400 truncate">{admin.email}</span>
                          <span className="text-slate-600 mx-1">|</span>
                          <span className="text-xs text-slate-500">{formatDate(admin.createdAt)}</span>
                        </div>
                      </div>

                      {/* Menu access badges */}
                      <div className="hidden md:flex items-center gap-1 flex-wrap max-w-[300px] justify-end">
                        {(adminAccessMap[admin.id] || ['Dashboard', 'Uniform Registry']).slice(0, 4).map((label) => (
                          <Badge
                            key={label}
                            variant="secondary"
                            className={cn(
                              "text-[10px] px-1.5 py-0 h-4",
                              label === 'Dashboard' || label === 'Uniform Registry'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            )}
                          >
                            {label}
                          </Badge>
                        ))}
                        {(adminAccessMap[admin.id] || []).length > 4 && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-slate-700 text-slate-300">
                            +{(adminAccessMap[admin.id] || []).length - 4}
                          </Badge>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleEdit(admin); }}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleDelete(admin); }}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                        <div
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-md transition-all duration-200',
                            isExpanded
                              ? 'bg-blue-500/15 text-blue-400 rotate-0'
                              : 'text-slate-400 hover:bg-slate-700/50'
                          )}
                        >
                          <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', isExpanded && 'rotate-180')} />
                        </div>
                      </div>
                    </div>

                    {/* Expanded: Manage Menu Access Section */}
                    {isExpanded && (
                      <div className="border-t border-slate-700/50">
                        <div className="px-4 py-4">
                          {/* Section Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <KeyRound className="h-4 w-4 text-emerald-400" />
                              <h3 className="text-sm font-semibold text-white">Manage Menu Access</h3>
                              <Badge variant="secondary" className="bg-slate-700/50 text-slate-300 text-[10px] px-1.5 py-0 h-4">
                                {grantedConfigurable}/{totalConfigurable} granted
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleAllPermissions(admin.id, true)}
                                className="h-7 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                              >
                                <ToggleRight className="h-3.5 w-3.5 mr-1" />
                                Grant All
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleAllPermissions(admin.id, false)}
                                className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                              >
                                <ToggleLeft className="h-3.5 w-3.5 mr-1" />
                                Revoke All
                              </Button>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="flex items-center gap-3 mb-4">
                            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                style={{ width: `${totalConfigurable > 0 ? (grantedConfigurable / totalConfigurable) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 whitespace-nowrap">
                              {grantedCount}/{perms.length} total
                            </span>
                          </div>

                          {isLoading ? (
                            <div className="space-y-3">
                              {[1, 2, 3].map((i) => (
                                <Skeleton key={i} className="h-14 w-full bg-slate-700 rounded-lg" />
                              ))}
                            </div>
                          ) : perms.length === 0 ? (
                            <div className="text-center py-8 text-slate-500 text-sm">No permissions found. Please refresh the page.</div>
                          ) : (
                            // Group permissions
                            <div className="space-y-3">
                              {['general', 'workforce', 'finance', 'admin'].map((group) => {
                                const groupPerms = perms.filter(p => p.group === group);
                                if (groupPerms.length === 0) return null;
                                const configurablePerms = groupPerms.filter(p => !p.isAlwaysVisible);
                                const alwaysVisiblePerms = groupPerms.filter(p => p.isAlwaysVisible);
                                const groupGrantedCount = groupPerms.filter(p => permState[p.slug]).length;
                                const allGroupGranted = groupGrantedCount === groupPerms.length;
                                const gc = GROUP_CONFIG[group] || GROUP_CONFIG.general;

                                return (
                                  <div
                                    key={group}
                                    className={cn('rounded-lg bg-slate-900/50 border px-4 py-3', gc.borderColor)}
                                  >
                                    {/* Group Header */}
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <p className={cn('text-xs font-semibold uppercase tracking-wider', gc.color)}>
                                          {gc.label}
                                        </p>
                                        <Badge variant="secondary" className="bg-slate-700/50 text-slate-300 text-[10px] px-1.5 py-0 h-4">
                                          {groupGrantedCount}/{groupPerms.length}
                                        </Badge>
                                      </div>
                                      {configurablePerms.length > 0 && (
                                        <button
                                          onClick={() => toggleGroupPermissions(admin.id, group, !allGroupGranted)}
                                          className={cn(
                                            'text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors',
                                            allGroupGranted
                                              ? 'text-red-400 hover:bg-red-500/10 border border-red-500/20'
                                              : 'text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20'
                                          )}
                                        >
                                          {allGroupGranted ? 'Clear All' : 'Select All'}
                                        </button>
                                      )}
                                    </div>

                                    {/* Always Visible Menus */}
                                    {alwaysVisiblePerms.length > 0 && (
                                      <div className="space-y-1.5 mb-2">
                                        {alwaysVisiblePerms.map((perm) => {
                                          const Icon = getMenuIcon(perm.slug);
                                          return (
                                            <div
                                              key={perm.id}
                                              className="flex items-center justify-between rounded-lg px-3 py-2 bg-emerald-500/5"
                                            >
                                              <div className="flex items-center gap-3">
                                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                                                  <Icon className="h-4 w-4" />
                                                </div>
                                                <div className="flex flex-col">
                                                  <span className="text-sm font-medium text-white">{perm.name}</span>
                                                  <span className="text-[10px] text-emerald-400/80">Always visible to all users</span>
                                                </div>
                                              </div>
                                              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] px-2 py-0.5 h-5">
                                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                                Always On
                                              </Badge>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Configurable (Hidden by default) Menus */}
                                    {configurablePerms.length > 0 && (
                                      <div className="space-y-1">
                                        {configurablePerms.map((perm) => {
                                          const isEnabled = permState[perm.slug] ?? false;
                                          const Icon = getMenuIcon(perm.slug);

                                          return (
                                            <div
                                              key={perm.id}
                                              className={cn(
                                                'flex items-center justify-between rounded-lg px-3 py-2.5 transition-all duration-200',
                                                isEnabled
                                                  ? 'bg-blue-500/5 border border-blue-500/10'
                                                  : 'bg-slate-800/30 border border-transparent hover:bg-slate-700/20'
                                              )}
                                            >
                                              <div className="flex items-center gap-3">
                                                <div className={cn(
                                                  'flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition-colors',
                                                  isEnabled
                                                    ? 'bg-blue-500/15 text-blue-400'
                                                    : 'bg-slate-700/50 text-slate-500'
                                                )}>
                                                  <Icon className="h-4 w-4" />
                                                </div>
                                                <div className="flex flex-col">
                                                  <span className={cn(
                                                    'text-sm font-medium transition-colors',
                                                    isEnabled ? 'text-white' : 'text-slate-400'
                                                  )}>
                                                    {perm.name}
                                                  </span>
                                                  <span className={cn(
                                                    'text-[10px] transition-colors',
                                                    isEnabled ? 'text-blue-400/70' : 'text-slate-500'
                                                  )}>
                                                    {isEnabled ? (
                                                      <span className="flex items-center gap-1">
                                                        <Eye className="h-3 w-3" /> Visible in sidebar
                                                      </span>
                                                    ) : (
                                                      <span className="flex items-center gap-1">
                                                        <EyeOff className="h-3 w-3" /> Hidden from sidebar
                                                      </span>
                                                    )}
                                                  </span>
                                                </div>
                                              </div>
                                              <Switch
                                                checked={isEnabled}
                                                onCheckedChange={(checked) => togglePermission(admin.id, perm.slug, checked)}
                                              />
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Info note */}
                          <div className="mt-4 rounded-lg bg-slate-900/30 border border-slate-700/30 px-3 py-2">
                            <p className="text-[11px] text-slate-500">
                              <KeyRound className="h-3 w-3 inline mr-1 -mt-0.5" />
                              Toggle switches to control which sidebar menus this admin can see. Changes take effect within 15 seconds.
                              Menus marked &quot;Always On&quot; are visible to all users by default.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-200 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              {editingAdmin ? (
                <>
                  <Pencil className="h-4 w-4 text-blue-400" />
                  Edit Account
                </>
              ) : formData.role === 'super_admin' ? (
                <>
                  <Crown className="h-4 w-4 text-amber-400" />
                  Create Super Admin
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 text-blue-400" />
                  Create Admin
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {editingAdmin
                ? 'Update account details. Leave password blank to keep unchanged.'
                : formData.role === 'super_admin'
                ? 'Create a new Super Admin account with full system access.'
                : 'Create a new admin account. You can configure menu access after creation.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Role Selection */}
            <div className="space-y-2">
              <Label className="text-slate-300">
                Role <span className="text-red-400">*</span>
              </Label>
              <Select
                value={formData.role}
                onValueChange={(value: 'admin' | 'super_admin') => setFormData(f => ({ ...f, role: value }))}
              >
                <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="admin" className="text-slate-200 focus:bg-slate-700 focus:text-white">
                    <div className="flex items-center gap-2">
                      <UserCog className="h-4 w-4 text-blue-400" />
                      <span>Admin</span>
                      <span className="text-xs text-slate-400 ml-1">(Configurable access)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="super_admin" className="text-slate-200 focus:bg-slate-700 focus:text-white">
                    <div className="flex items-center gap-2">
                      <Crown className="h-4 w-4 text-amber-400" />
                      <span>Super Admin</span>
                      <span className="text-xs text-slate-400 ml-1">(Full access)</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="admin-name" className="text-slate-300">
                Name <span className="text-red-400">*</span>
              </Label>
              <div className="relative">
                <UserCog className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="admin-name"
                  placeholder="Enter full name"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData((f) => ({ ...f, name: e.target.value }));
                    if (formErrors.name) setFormErrors((fe) => ({ ...fe, name: '' }));
                  }}
                  className="pl-9 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-blue-500/30 focus:border-blue-500/50"
                />
              </div>
              {formErrors.name && (
                <p className="text-xs text-red-400">{formErrors.name}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="admin-email" className="text-slate-300">
                Email <span className="text-red-400">*</span>
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="admin-email"
                  type="email"
                  placeholder="admin@example.com"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData((f) => ({ ...f, email: e.target.value }));
                    if (formErrors.email) setFormErrors((fe) => ({ ...fe, email: '' }));
                  }}
                  className="pl-9 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-blue-500/30 focus:border-blue-500/50"
                />
              </div>
              {formErrors.email && (
                <p className="text-xs text-red-400">{formErrors.email}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="admin-password" className="text-slate-300">
                Password {editingAdmin ? '' : <span className="text-red-400">*</span>}
                {editingAdmin && (
                  <span className="text-slate-500 font-normal ml-1">(optional)</span>
                )}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="admin-password"
                  type="password"
                  placeholder={editingAdmin ? 'Leave blank to keep current' : 'Enter password (min 6 chars)'}
                  value={formData.password}
                  onChange={(e) => {
                    setFormData((f) => ({ ...f, password: e.target.value }));
                    if (formErrors.password) setFormErrors((fe) => ({ ...fe, password: '' }));
                  }}
                  className="pl-9 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-blue-500/30 focus:border-blue-500/50"
                />
              </div>
              {formErrors.password && (
                <p className="text-xs text-red-400">{formErrors.password}</p>
              )}
            </div>

            {/* Super Admin Warning */}
            {formData.role === 'super_admin' && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400">
                <div className="flex items-start gap-2">
                  <Crown className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Super Admin Privileges</p>
                    <p className="text-amber-400/80 text-xs mt-1">
                      This account will have full system access including managing other admins, creating super admins, and accessing all system features.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Admin Access Info */}
            {formData.role === 'admin' && !editingAdmin && (
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3 text-sm text-blue-400">
                <div className="flex items-start gap-2">
                  <KeyRound className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Menu Access Control</p>
                    <p className="text-blue-400/80 text-xs mt-1">
                      This admin will see Dashboard and Materials Registry by default. After creation, expand the admin card to grant or revoke additional sidebar menus.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              className="text-slate-400 hover:text-white hover:bg-slate-700"
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className={formData.role === 'super_admin' ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {editingAdmin ? 'Updating...' : 'Creating...'}
                </span>
              ) : (
                <>
                  {editingAdmin ? (
                    <>
                      <Pencil className="h-4 w-4 mr-2" />
                      Update Account
                    </>
                  ) : (
                    <>
                      {formData.role === 'super_admin' ? (
                        <>
                          <Crown className="h-4 w-4 mr-2" />
                          Create Super Admin
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-2" />
                          Create Admin
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Delete {deletingAdmin?.role === 'super_admin' ? 'Super Admin' : 'Admin'} Account
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Are you sure you want to delete the {deletingAdmin?.role === 'super_admin' ? 'super admin' : 'admin'} account for{' '}
              <span className="text-white font-semibold">{deletingAdmin?.name}</span>? This action
              cannot be undone. The user will lose all access to the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel
              className="text-slate-400 hover:text-white hover:bg-slate-700 border-slate-700"
              disabled={deleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white focus:ring-red-500/30 focus:ring-offset-slate-800 border-0"
            >
              {deleting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Deleting...
                </span>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
