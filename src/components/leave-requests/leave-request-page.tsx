'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FileText,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  X,
  CalendarDays,
  Loader2,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertCircle,
  User,
  Download,
  Printer,
  MessageCircle,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';

/* ───────── Types ───────── */
interface Employee {
  id: string;
  fullName: string;
  employeeId: string;
  position: string | null;
  companyName: string | null;
  phone: string | null;
  nationality: string | null;
  idNumber: string | null;
}

interface LeaveRequest {
  id: string;
  employeeId: string;
  employee: Employee;
  type: string;
  otherTypeText: string | null;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: string;
  createdBy: { id: string; name: string; email: string };
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ───────── Constants ───────── */
const LEAVE_TYPES = [
  { value: 'casual', label: 'Casual Leave' },
  { value: 'sick', label: 'Sick Leave' },
  { value: 'annual', label: 'Annual Leave' },
  { value: 'emergency', label: 'Emergency Leave' },
  { value: 'marriage', label: 'Marriage Leave' },
  { value: 'other', label: 'Other' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/15 text-green-400 border-green-500/25', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-500/15 text-red-400 border-red-500/25', icon: XCircle },
};

/* ───────── PDF & Print Helpers ───────── */
function formatFormalDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function generateLeavePdfDoc(req: LeaveRequest): jsPDF {
  const doc = new jsPDF();
  const typeLabels: Record<string, string> = {
    casual: 'Casual Leave',
    sick: 'Sick Leave',
    annual: 'Annual Leave',
    emergency: 'Emergency Leave',
    marriage: 'Marriage Leave',
    other: `Other (${req.otherTypeText || ''})`,
  };
  const leaveType = typeLabels[req.type] || req.type;
  const submissionDate = formatFormalDate(new Date().toISOString());
  const statusLabel = req.status.charAt(0).toUpperCase() + req.status.slice(1);

  // Company header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('ARABIAN SHIELD MANPOWER LLC.', 105, 25, { align: 'center' });
  doc.setDrawColor(139, 0, 0);
  doc.setLineWidth(1.5);
  doc.line(20, 32, 190, 32);

  // Title
  let y = 42;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(139, 0, 0);
  doc.text('LEAVE APPLICATION FORM', 105, y, { align: 'center' });
  y += 12;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Reference: LEAVE-${req.id.substring(0, 8)}`, 20, y);
  doc.text(`Application Date: ${formatFormalDate(req.createdAt)}`, 190, y, { align: 'right' });
  doc.text(`Status: ${statusLabel}`, 190, y + 7, { align: 'right' });
  y += 14;

  // Separator
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(20, y, 190, y);
  y += 10;

  // Section: Employee Information
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(139, 0, 0);
  doc.text('EMPLOYEE INFORMATION', 20, y);
  y += 8;
  doc.setDrawColor(180, 180, 180);
  doc.line(20, y, 190, y);
  y += 7;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  const empFields = [
    ['Employee Name', req.employee.fullName],
    ['Employee ID', req.employee.employeeId],
    ['Designation', req.employee.position || 'N/A'],
    ['Company', req.employee.companyName || 'N/A'],
    ['Contact', req.employee.phone || 'N/A'],
    ['Nationality', req.employee.nationality || 'N/A'],
  ];
  for (const [label, value] of empFields) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 20, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, 70, y);
    y += 7;
  }
  y += 5;

  // Section: Leave Details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(139, 0, 0);
  doc.text('LEAVE DETAILS', 20, y);
  y += 8;
  doc.setDrawColor(180, 180, 180);
  doc.line(20, y, 190, y);
  y += 7;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  const leaveFields = [
    ['Leave Type', leaveType],
    ['Start Date', formatFormalDate(req.startDate)],
    ['End Date', formatFormalDate(req.endDate)],
    ['Total Days', `${req.totalDays} day${req.totalDays > 1 ? 's' : ''}`],
  ];
  for (const [label, value] of leaveFields) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 20, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, 70, y);
    y += 7;
  }
  y += 5;

  // Section: Reason
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(139, 0, 0);
  doc.text('REASON FOR LEAVE', 20, y);
  y += 8;
  doc.setDrawColor(180, 180, 180);
  doc.line(20, y, 190, y);
  y += 7;

  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  const reasonLines = doc.splitTextToSize(req.reason, 170);
  doc.text(reasonLines, 20, y);
  y += reasonLines.length * 6 + 10;

  // Review status if applicable
  if (req.status !== 'pending' && req.reviewedBy) {
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${statusLabel} by: ${req.reviewedBy}`, 20, y);
    y += 10;
  }

  // Signature area
  y += 10;
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.3);
  doc.line(20, y, 190, y);
  y += 15;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Employee Signature: _______________', 25, y);
  doc.text('HR / Office Admin: _______________', 115, y);
  y += 20;

  // Footer
  doc.setDrawColor(200, 200, 200);
  doc.line(20, y, 190, y);
  y += 7;
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('This is a computer-generated document from Arabian Shield Manpower LLC.', 105, y, { align: 'center' });

  return doc;
}

function downloadLeaveRequestPdf(req: LeaveRequest) {
  const doc = generateLeavePdfDoc(req);
  const filename = `leave-application-${req.employee.fullName.replace(/\s+/g, '-').toLowerCase()}-${req.id.substring(0, 8)}.pdf`;
  doc.save(filename);
}

function printLeaveRequest(req: LeaveRequest) {
  const typeLabels: Record<string, string> = {
    casual: 'Casual', sick: 'Sick', annual: 'Annual',
    emergency: 'Emergency', marriage: 'Marriage',
    other: `Other (${req.otherTypeText || ''})`,
  };
  const leaveType = typeLabels[req.type] || req.type;
  const submissionDate = formatFormalDate(new Date().toISOString());
  const statusLabel = req.status.charAt(0).toUpperCase() + req.status.slice(1);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Leave Application - ${req.employee.fullName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; background: #f0f0f0; padding: 40px 20px; display: flex; justify-content: center; }
  .leave-form { max-width: 900px; width: 100%; background: white; border: 1px solid #999; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
  .header { text-align: center; padding: 20px 20px 10px; border-bottom: 2px solid #c00; }
  .header h1 { font-size: 28px; font-weight: bold; letter-spacing: 2px; color: #8b0000; margin-bottom: 4px; }
  .header h2 { font-size: 18px; font-weight: normal; color: #333; margin-top: 4px; }
  .content { padding: 24px 30px 30px; }
  .field-row { display: flex; margin-bottom: 16px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
  .field-label { width: 180px; font-weight: bold; color: #1a1a1a; font-size: 14px; }
  .field-value { flex: 1; font-size: 14px; color: #222; border-bottom: 1px dotted #aaa; padding-left: 8px; }
  .section-title { font-weight: bold; margin: 20px 0 10px; font-size: 16px; background: #f5f5f5; padding: 6px 10px; border-left: 4px solid #8b0000; }
  .signature-area { margin-top: 36px; display: flex; justify-content: space-between; padding-top: 20px; border-top: 1px dashed #ccc; }
  .signature { text-align: center; width: 200px; }
  .signature-line { margin-top: 40px; border-top: 1px solid #333; width: 100%; }
  .signature p { margin-top: 8px; font-size: 12px; color: #555; }
  .footer { text-align: center; font-size: 11px; color: #666; padding: 15px; border-top: 1px solid #eee; margin-top: 20px; }
</style></head>
<body>
<div class="leave-form">
  <div class="header"><h1>LEAVE APPLICATION FORM</h1><h2>Arabian Shield Manpower LLC.</h2></div>
  <div class="content">
    <div class="field-row"><div class="field-label">EMPLOYEE NAME</div><div class="field-value">${req.employee.fullName}</div></div>
    <div class="field-row"><div class="field-label">EMPLOYEE ID</div><div class="field-value">${req.employee.employeeId}</div></div>
    <div class="field-row"><div class="field-label">DESIGNATION</div><div class="field-value">${req.employee.position || 'N/A'}</div></div>
    <div class="field-row"><div class="field-label">COMPANY NAME</div><div class="field-value">${req.employee.companyName || 'N/A'}</div></div>
    <div class="field-row"><div class="field-label">CONTACT NUMBER</div><div class="field-value">${req.employee.phone || 'N/A'}</div></div>
    <div class="field-row"><div class="field-label">NATIONALITY</div><div class="field-value">${req.employee.nationality || 'N/A'}</div></div>
    <div class="field-row"><div class="field-label">APP. SUBMISSION DATE</div><div class="field-value">${submissionDate}</div></div>
    <div class="field-row"><div class="field-label">STATUS</div><div class="field-value">${statusLabel}</div></div>
    <div class="section-title">Leave Details</div>
    <div class="field-row"><div class="field-label">Type of Leave</div><div class="field-value">${leaveType}</div></div>
    <div class="field-row"><div class="field-label">Leave Period</div><div class="field-value">From: ${formatFormalDate(req.startDate)}  To: ${formatFormalDate(req.endDate)}</div></div>
    <div class="field-row"><div class="field-label">Total No. of Days</div><div class="field-value">${req.totalDays} DAYS</div></div>
    <div class="section-title">Reason for Leave</div>
    <div class="field-row"><div class="field-value" style="border:none; white-space: pre-wrap;">${req.reason}</div></div>
    <div class="signature-area">
      <div class="signature"><div class="signature-line"></div><p>Employee Signature</p></div>
      <div class="signature"><div class="signature-line"></div><p>HR / OFFICE ADMIN</p></div>
    </div>
  </div>
  <div class="footer">This is a computer-generated document from Arabian Shield Manpower LLC.</div>
</div>
</body></html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }
}

async function sendLeaveRequestWhatsApp(req: LeaveRequest) {
  try {
    const doc = generateLeavePdfDoc(req);
    const pdfBlob = doc.output('blob');
    const file = new File([pdfBlob], `leave-application-${req.employee.fullName.replace(/\s+/g, '-')}.pdf`, { type: 'application/pdf' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'Leave Application',
        text: `Leave Application - ${req.employee.fullName} (${req.employee.employeeId})`,
      });
    } else {
      // Fallback: download PDF first, then open WhatsApp with text
      const filename = `leave-application-${req.employee.fullName.replace(/\s+/g, '-').toLowerCase()}-${req.id.substring(0, 8)}.pdf`;
      doc.save(filename);
      const message = encodeURIComponent(
        `*LEAVE APPLICATION - ARABIAN SHIELD MANPOWER LLC.*\n\nEmployee: ${req.employee.fullName}\nID: ${req.employee.employeeId}\nType: ${req.type}\nFrom: ${formatFormalDate(req.startDate)} To: ${formatFormalDate(req.endDate)}\nDays: ${req.totalDays}\nReason: ${req.reason}\n\nPlease find the attached PDF for complete details.`
      );
      window.open(`https://wa.me/?text=${message}`, '_blank');
    }
  } catch (err) {
    // User cancelled share or error
    if ((err as Error).name !== 'AbortError') {
      console.error('Share failed:', err);
    }
  }
}

/* ───────── Searchable Employee Dropdown ───────── */
interface SearchableEmployeeSelectProps {
  employees: Employee[];
  value: string;
  onChange: (id: string) => void;
}

function SearchableEmployeeSelect({ employees, value, onChange }: SearchableEmployeeSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = employees.find((e) => e.id === value);

  const filtered = search
    ? employees.filter(
        (e) =>
          e.fullName.toLowerCase().includes(search.toLowerCase()) ||
          e.employeeId.toLowerCase().includes(search.toLowerCase()) ||
          (e.idNumber && e.idNumber.toLowerCase().includes(search.toLowerCase()))
      )
    : employees;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full h-10 rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-white hover:bg-slate-800 transition-colors text-left"
      >
        <User className="h-4 w-4 text-slate-500 shrink-0" />
        <span className="truncate flex-1">
          {selected ? `${selected.fullName} - ${selected.idNumber || selected.employeeId}` : 'Select employee...'}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl shadow-black/40 overflow-hidden">
          <div className="p-2 border-b border-slate-700">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or ID..."
                className="w-full h-8 pl-8 pr-3 bg-slate-900 border border-slate-600 rounded-md text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500">No employees found</div>
            ) : (
              filtered.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => {
                    onChange(emp.id);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-slate-700/50',
                    emp.id === value ? 'bg-slate-700/70 text-white' : 'text-slate-300'
                  )}
                >
                  <span className="truncate flex-1">{emp.fullName} - {emp.idNumber || emp.employeeId}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Status Badge ───────── */
function LeaveStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <Badge className={cn('gap-1', cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

/* ───────── Empty State ───────── */
function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-700/50 mb-4">
        <FileText className="h-8 w-8 text-slate-500" />
      </div>
      <h3 className="text-base font-semibold text-white mb-1">
        {hasFilters ? 'No leave requests found' : 'No leave requests yet'}
      </h3>
      <p className="text-sm text-slate-500 max-w-sm">
        {hasFilters
          ? 'Try adjusting your filters to find what you\'re looking for.'
          : 'Create a new leave request to get started.'}
      </p>
    </div>
  );
}

/* ───────── Table Skeleton ───────── */
function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full bg-slate-700" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40 bg-slate-700" />
            <Skeleton className="h-3 w-24 bg-slate-700" />
          </div>
          <Skeleton className="h-5 w-20 bg-slate-700" />
          <Skeleton className="h-5 w-16 bg-slate-700" />
          <Skeleton className="h-5 w-16 bg-slate-700" />
        </div>
      ))}
    </div>
  );
}

/* ───────── Main Component ───────── */
export function LeaveRequestPage() {
  const { user } = useAuthStore();
  const { toast } = useToast();

  // Data state
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState<LeaveRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected'>('approved');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    employeeId: '',
    type: 'casual',
    otherTypeText: '',
    startDate: '',
    endDate: '',
    totalDays: 1,
    reason: '',
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [searchQuery]);

  // Fetch leave requests
  const fetchLeaveRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/leave-requests?${params}`);
      const json = await res.json();
      if (json.success) {
        setLeaveRequests(json.data.leaveRequests || []);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch leave requests', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, toast]);

  // Fetch employees for the form dropdown
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/employees?limit=1000&status=active');
      const json = await res.json();
      if (json.success) {
        setEmployees(json.data.employees || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchLeaveRequests();
  }, [fetchLeaveRequests]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Calculate total days between start and end date
  useEffect(() => {
    if (formData.startDate && formData.endDate) {
      const start = new Date(formData.startDate);
      const end = new Date(formData.endDate);
      const diffTime = end.getTime() - start.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      setFormData((prev) => ({ ...prev, totalDays: diffDays > 0 ? diffDays : 1 }));
    }
  }, [formData.startDate, formData.endDate]);

  // Filter by search
  const filteredRequests = useMemo(() => {
    if (!debouncedSearch) return leaveRequests;
    const q = debouncedSearch.toLowerCase();
    return leaveRequests.filter(
      (r) =>
        r.employee.fullName.toLowerCase().includes(q) ||
        r.employee.employeeId.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q)
    );
  }, [leaveRequests, debouncedSearch]);

  // Stats
  const stats = useMemo(() => ({
    total: leaveRequests.length,
    pending: leaveRequests.filter((r) => r.status === 'pending').length,
    approved: leaveRequests.filter((r) => r.status === 'approved').length,
    rejected: leaveRequests.filter((r) => r.status === 'rejected').length,
  }), [leaveRequests]);

  // Handle create leave request
  const handleCreate = async () => {
    if (!formData.employeeId || !formData.type || !formData.startDate || !formData.endDate || !formData.reason) {
      toast({ title: 'Validation Error', description: 'Please fill in all required fields', variant: 'destructive' });
      return;
    }
    if (!user) {
      toast({ title: 'Error', description: 'You must be logged in', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: formData.employeeId,
          type: formData.type,
          otherTypeText: formData.type === 'other' ? formData.otherTypeText : undefined,
          startDate: formData.startDate,
          endDate: formData.endDate,
          totalDays: formData.totalDays,
          reason: formData.reason,
          createdById: user.id,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Success', description: 'Leave request created successfully' });
        setCreateDialogOpen(false);
        resetForm();
        fetchLeaveRequests();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to create leave request', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle review (approve/reject)
  const handleReview = async () => {
    if (!reviewingRequest || !user) return;
    setIsReviewing(true);
    try {
      const res = await fetch(`/api/leave-requests/${reviewingRequest.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: reviewAction,
          reviewedBy: user.id,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({
          title: reviewAction === 'approved' ? 'Leave Approved' : 'Leave Rejected',
          description: `The leave request has been ${reviewAction}.`,
        });
        setReviewDialogOpen(false);
        setReviewingRequest(null);
        fetchLeaveRequests();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to review request', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong', variant: 'destructive' });
    } finally {
      setIsReviewing(false);
    }
  };

  const resetForm = () => {
    setFormData({
      employeeId: '',
      type: 'casual',
      otherTypeText: '',
      startDate: '',
      endDate: '',
      totalDays: 1,
      reason: '',
    });
  };

  const openCreateDialog = () => {
    resetForm();
    setCreateDialogOpen(true);
  };

  const openReviewDialog = (request: LeaveRequest, action: 'approved' | 'rejected') => {
    setReviewingRequest(request);
    setReviewAction(action);
    setReviewDialogOpen(true);
  };

  const formatLeaveType = (type: string, otherText?: string | null) => {
    const found = LEAVE_TYPES.find((t) => t.value === type);
    if (type === 'other' && otherText) return otherText;
    return found?.label || type;
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Leave Requests</h2>
          <p className="text-slate-400 mt-1">Manage employee leave requests and approvals.</p>
        </div>
        <Button
          onClick={openCreateDialog}
          className="bg-blue-500 hover:bg-blue-600 text-white gap-2 self-start"
        >
          <Plus className="h-4 w-4" />
          New Leave Request
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { title: 'Total', value: stats.total, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
          { title: 'Pending', value: stats.pending, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
          { title: 'Approved', value: stats.approved, color: 'text-green-400', bgColor: 'bg-green-500/10' },
          { title: 'Rejected', value: stats.rejected, color: 'text-red-400', bgColor: 'bg-red-500/10' },
        ].map((stat) => (
          <Card key={stat.title} className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardContent className="px-4 py-0">
              <p className="text-xs text-slate-400 font-medium">{stat.title}</p>
              <p className={cn('text-2xl font-bold', stat.color)}>{isLoading ? '...' : stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search & Filters */}
      <Card className="bg-slate-800 border-slate-700 rounded-xl">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name, ID, type, reason..."
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] bg-slate-900 border-slate-600 text-white h-9">
                <Filter className="h-4 w-4 mr-2 text-slate-400" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Leave Requests Table */}
      <Card className="bg-slate-800 border-slate-700 rounded-xl overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : filteredRequests.length === 0 ? (
          <EmptyState hasFilters={!!debouncedSearch || statusFilter !== 'all'} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50 hover:bg-transparent">
                  <TableHead className="text-slate-400 font-medium">Employee</TableHead>
                  <TableHead className="text-slate-400 font-medium">Leave Type</TableHead>
                  <TableHead className="text-slate-400 font-medium">Duration</TableHead>
                  <TableHead className="text-slate-400 font-medium">Reason</TableHead>
                  <TableHead className="text-slate-400 font-medium">Status</TableHead>
                  <TableHead className="text-slate-400 font-medium">Created</TableHead>
                  <TableHead className="text-slate-400 font-medium text-right">Document</TableHead>
                  {isSuperAdmin && (
                    <TableHead className="text-slate-400 font-medium text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.map((request) => (
                  <TableRow
                    key={request.id}
                    className="border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                  >
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-white">{request.employee.fullName}</p>
                        <p className="text-xs text-slate-500">{request.employee.employeeId}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-300">
                        {formatLeaveType(request.type, request.otherTypeText)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm text-white font-medium">{request.totalDays} day{request.totalDays > 1 ? 's' : ''}</p>
                        <p className="text-xs text-slate-500">
                          {formatDate(request.startDate)} - {formatDate(request.endDate)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-slate-300 max-w-[200px] truncate" title={request.reason}>
                        {request.reason}
                      </p>
                    </TableCell>
                    <TableCell>
                      <LeaveStatusBadge status={request.status} />
                    </TableCell>
                    <TableCell>
                      <p className="text-xs text-slate-500">{formatDate(request.createdAt)}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-slate-400 hover:text-white hover:bg-slate-700/50 gap-1"
                          onClick={() => downloadLeaveRequestPdf(request)}
                          title="Download PDF"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-slate-400 hover:text-white hover:bg-slate-700/50 gap-1"
                          onClick={() => printLeaveRequest(request)}
                          title="Print"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-green-400 hover:text-green-300 hover:bg-green-500/10 gap-1"
                          onClick={() => sendLeaveRequestWhatsApp(request)}
                          title="Send via WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        {request.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-green-400 hover:text-green-300 hover:bg-green-500/10 gap-1"
                              onClick={() => openReviewDialog(request, 'approved')}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1"
                              onClick={() => openReviewDialog(request, 'rejected')}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <div className="text-right">
                            {request.reviewedBy && (
                              <p className="text-xs text-slate-500">by {request.reviewedBy}</p>
                            )}
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Create Leave Request Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">New Leave Request</DialogTitle>
            <DialogDescription className="text-slate-400">
              Submit a leave request for an employee.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Employee Select */}
            <div className="space-y-2">
              <Label className="text-slate-300">Employee *</Label>
              <SearchableEmployeeSelect
                employees={employees}
                value={formData.employeeId}
                onChange={(id) => setFormData((prev) => ({ ...prev, employeeId: id }))}
              />
            </div>

            {/* Leave Type */}
            <div className="space-y-2">
              <Label className="text-slate-300">Leave Type *</Label>
              <Select
                value={formData.type}
                onValueChange={(val) => setFormData((prev) => ({ ...prev, type: val }))}
              >
                <SelectTrigger className="bg-slate-900 border-slate-600 text-white">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {LEAVE_TYPES.map((lt) => (
                    <SelectItem key={lt.value} value={lt.value}>
                      {lt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Other Type Text */}
            {formData.type === 'other' && (
              <div className="space-y-2">
                <Label className="text-slate-300">Specify Leave Type *</Label>
                <Input
                  value={formData.otherTypeText}
                  onChange={(e) => setFormData((prev) => ({ ...prev, otherTypeText: e.target.value }))}
                  placeholder="Enter leave type..."
                  className="bg-slate-900 border-slate-600 text-white"
                />
              </div>
            )}

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Start Date *</Label>
                <Input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="bg-slate-900 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">End Date *</Label>
                <Input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="bg-slate-900 border-slate-600 text-white"
                />
              </div>
            </div>

            {/* Total Days */}
            <div className="space-y-2">
              <Label className="text-slate-300">Total Days</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={formData.totalDays}
                  onChange={(e) => setFormData((prev) => ({ ...prev, totalDays: parseInt(e.target.value) || 1 }))}
                  className="bg-slate-900 border-slate-600 text-white w-24"
                />
                <span className="text-sm text-slate-400">day{formData.totalDays > 1 ? 's' : ''}</span>
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label className="text-slate-300">Reason *</Label>
              <Textarea
                value={formData.reason}
                onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Enter the reason for the leave..."
                className="bg-slate-900 border-slate-600 text-white min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateDialogOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isSubmitting}
              className="bg-blue-500 hover:bg-blue-600 text-white gap-2"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Confirmation Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              {reviewAction === 'approved' ? 'Approve Leave Request' : 'Reject Leave Request'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {reviewingRequest && (
                <>
                  You are about to {reviewAction === 'approved' ? 'approve' : 'reject'} the{' '}
                  <span className="text-white font-medium">{formatLeaveType(reviewingRequest.type, reviewingRequest.otherTypeText)}</span> leave
                  request for <span className="text-white font-medium">{reviewingRequest.employee.fullName}</span>{' '}
                  ({reviewingRequest.totalDays} day{reviewingRequest.totalDays > 1 ? 's' : ''}).
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setReviewDialogOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleReview}
              disabled={isReviewing}
              className={cn(
                'gap-2 text-white',
                reviewAction === 'approved'
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-red-500 hover:bg-red-600'
              )}
            >
              {isReviewing && <Loader2 className="h-4 w-4 animate-spin" />}
              {reviewAction === 'approved' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
