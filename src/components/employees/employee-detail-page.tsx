'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Pencil,
  Crown,
  ShieldCheck,
  User,
  Globe,
  Calendar,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Building2,
  Clock,
  Star,
  Download,
  MessageCircle,
  Shield,
  AlertTriangle,
  FileText,
  Loader2,
  CreditCard,
  BookOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/store/app-store';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';

// ─── Types ───────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  fullName: string;
  employeeId: string;
  nationality: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergencyContact: string | null;
  position: string | null;
  trade: string | null;
  joinDate: string | null;
  companyName: string | null;
  passportNumber: string | null;
  passportStatus: string | null;
  idNumber: string | null;
  idStatus: string | null;
  currentSite: string | null;
  isTeamLeader: boolean;
  teamLeaderSiteId: string | null;
  isSupervisor: boolean;
  supervisorSiteId: string | null;
  customHourlyRate?: number | null;
  hoursThreshold?: number;
  currentTotalWorkingHours?: number;
  rating: number;
  status: string;
  photo: string | null;
  createdAt: string;
  updatedAt: string;
  attendance?: unknown[];
  warnings?: unknown[];
  fines?: unknown[];
}

interface Site {
  id: string;
  name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
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

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    inactive: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
    deleted: 'bg-red-500/15 text-red-400 border-red-500/25',
    pending_deletion: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  };
  const colorClass = colors[status] || colors.inactive;
  return (
    <Badge className={`${colorClass} text-[10px] px-2 py-0.5 border`}>
      {status.replace('_', ' ').toUpperCase()}
    </Badge>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-4 w-4 ${
            star <= rating
              ? 'text-amber-400 fill-amber-400'
              : 'text-slate-600'
          }`}
        />
      ))}
    </div>
  );
}

// ─── Info Row Component ──────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
  copyable = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
  copyable?: boolean;
}) {
  const displayValue = value && value.trim() ? value : '—';
  return (
    <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-800/50 transition-colors">
      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-slate-700/50 flex-shrink-0 mt-0.5">
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
        <p className="text-sm text-slate-200 font-medium break-words">{displayValue}</p>
      </div>
    </div>
  );
}

// ─── Section Card Component ──────────────────────────────────────────────

function SectionCard({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="bg-slate-800/50 border-slate-700/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Icon className="h-4 w-4 text-slate-400" />
            {title}
          </CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {children}
      </CardContent>
    </Card>
  );
}

// ─── PDF CV Generation ───────────────────────────────────────────────────

function generateEmployeeCV(employee: Employee, sites: Site[]): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;

  // ── Header: Company logo + name ──
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 42, 'F');

  // Company name
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Arabian Shield Manpower', margin, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text('Employee Profile & Service Record', margin, 26);

  // Document ID on the right
  doc.setFontSize(8);
  doc.text(`Doc: ${employee.employeeId}`, pageWidth - margin, 18, { align: 'right' });
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin, 26, { align: 'right' });

  // ── Employee Name Banner ──
  let y = 52;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(employee.fullName, margin, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105); // slate-600
  const subtitleParts: string[] = [];
  if (employee.trade) subtitleParts.push(employee.trade);
  if (employee.position) subtitleParts.push(employee.position);
  if (employee.currentSite) subtitleParts.push(`Site: ${employee.currentSite}`);
  if (subtitleParts.length > 0) {
    doc.text(subtitleParts.join('  •  '), margin, y);
  }

  // Role badges
  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  let badgeX = margin;
  if (employee.isTeamLeader) {
    doc.setFillColor(245, 158, 11); // amber-500
    doc.roundedRect(badgeX, y - 4, 28, 6, 1, 1, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text('Team Leader', badgeX + 14, y, { align: 'center' });
    badgeX += 32;
  }
  if (employee.isSupervisor) {
    doc.setFillColor(139, 92, 246); // violet-500
    doc.roundedRect(badgeX, y - 4, 24, 6, 1, 1, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text('Supervisor', badgeX + 12, y, { align: 'center' });
    badgeX += 28;
  }
  // Status badge
  const statusColor: Record<string, [number, number, number]> = {
    active: [16, 185, 129],
    inactive: [100, 116, 139],
    pending_deletion: [245, 158, 11],
    deleted: [239, 68, 68],
  };
  const [sr, sg, sb] = statusColor[employee.status] || statusColor.inactive;
  doc.setFillColor(sr, sg, sb);
  doc.roundedRect(badgeX, y - 4, 22, 6, 1, 1, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(employee.status.replace('_', ' ').toUpperCase(), badgeX + 11, y, { align: 'center' });

  // ── Separator line ──
  y += 10;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);

  // ── Helper to draw a section header ──
  const drawSectionHeader = (title: string, yPos: number): number => {
    doc.setFillColor(241, 245, 249); // slate-100
    doc.roundedRect(margin, yPos, contentWidth, 7, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(title.toUpperCase(), margin + 3, yPos + 5);
    return yPos + 12;
  };

  // ── Helper to draw a field row ──
  const drawField = (label: string, value: string | null | undefined, yPos: number, col: 'left' | 'right' = 'left'): number => {
    const colWidth = (contentWidth - 6) / 2;
    const x = col === 'left' ? margin : margin + colWidth + 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(label.toUpperCase(), x, yPos);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    const displayValue = value && value.trim() ? value : '—';
    const splitText = doc.splitTextToSize(displayValue, colWidth);
    doc.text(splitText[0], x, yPos + 5);
    return yPos;
  };

  // ── Personal Information Section ──
  y = drawSectionHeader('Personal Information', y);
  const colWidth = (contentWidth - 6) / 2;
  const rowSpacing = 12;
  drawField('Employee ID', employee.employeeId, y, 'left');
  drawField('Nationality', employee.nationality, y, 'right');
  y += rowSpacing;
  drawField('Date of Birth', formatDate(employee.dateOfBirth), y, 'left');
  drawField('Phone', employee.phone, y, 'right');
  y += rowSpacing;
  drawField('Email', employee.email, y, 'left');
  drawField('Emergency Contact', employee.emergencyContact, y, 'right');
  y += rowSpacing;
  drawField('Address', employee.address, y, 'left');
  y += rowSpacing + 4;

  // ── Professional Information Section ──
  if (y > pageHeight - 80) { doc.addPage(); y = margin + 5; }
  y = drawSectionHeader('Professional Information', y);
  drawField('Trade', employee.trade, y, 'left');
  drawField('Position', employee.position, y, 'right');
  y += rowSpacing;
  drawField('Company Name', employee.companyName, y, 'left');
  drawField('Current Site', employee.currentSite, y, 'right');
  y += rowSpacing;
  drawField('Join Date', formatDate(employee.joinDate), y, 'left');
  drawField('Rating', employee.rating > 0 ? `${employee.rating} / 5` : '—', y, 'right');
  y += rowSpacing + 4;

  // ── Identification Section ──
  if (y > pageHeight - 70) { doc.addPage(); y = margin + 5; }
  y = drawSectionHeader('Identification Documents', y);
  drawField('Passport Number', employee.passportNumber, y, 'left');
  drawField('Passport Status', employee.passportStatus, y, 'right');
  y += rowSpacing;
  drawField('ID Number', employee.idNumber, y, 'left');
  drawField('ID Status', employee.idStatus, y, 'right');
  y += rowSpacing + 4;

  // ── Work Configuration Section ──
  if (y > pageHeight - 60) { doc.addPage(); y = margin + 5; }
  y = drawSectionHeader('Work Configuration', y);
  drawField('Custom Hourly Rate', employee.customHourlyRate != null ? `${employee.customHourlyRate} AED/hr` : '—', y, 'left');
  drawField('Hours Threshold', employee.hoursThreshold ? `${employee.hoursThreshold} hrs` : '—', y, 'right');
  y += rowSpacing;
  drawField(
    'Current Total Hours',
    employee.currentTotalWorkingHours != null ? `${employee.currentTotalWorkingHours} hrs` : '—',
    y,
    'left',
  );

  // Team leader / supervisor site
  if (employee.isTeamLeader && employee.teamLeaderSiteId) {
    const site = sites.find((s) => s.id === employee.teamLeaderSiteId);
    drawField('Team Leader At', site?.name || '—', y, 'right');
  } else if (employee.isSupervisor && employee.supervisorSiteId) {
    const site = sites.find((s) => s.id === employee.supervisorSiteId);
    drawField('Supervisor At', site?.name || '—', y, 'right');
  } else {
    drawField('Role', 'Standard', y, 'right');
  }
  y += rowSpacing + 4;

  // ── Footer ──
  const footerY = pageHeight - 15;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    'This document is computer-generated and may not require a physical signature.',
    margin,
    footerY,
  );
  doc.text(
    `Arabian Shield Manpower  •  ${new Date().getFullYear()}`,
    pageWidth - margin,
    footerY,
    { align: 'right' },
  );

  // ── Save ──
  const fileName = `CV_${employee.fullName.replace(/\s+/g, '_')}_${employee.employeeId}.pdf`;
  doc.save(fileName);
}

// ─── Main Component ──────────────────────────────────────────────────────

export function EmployeeDetailPage() {
  const { selectedEmployeeId, setCurrentView } = useAppStore();
  const { toast } = useToast();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickHoursValue, setQuickHoursValue] = useState('');
  const [quickHoursSaving, setQuickHoursSaving] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  // Fetch employee details
  const fetchEmployee = useCallback(async () => {
    if (!selectedEmployeeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/employees/${selectedEmployeeId}`);
      const data = await res.json();
      if (data.success) {
        setEmployee(data.employee);
        if (data.employee.currentTotalWorkingHours != null) {
          setQuickHoursValue(String(data.employee.currentTotalWorkingHours));
        }
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to load employee', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load employee', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [selectedEmployeeId, toast]);

  // Fetch sites (for team-leader/supervisor site name resolution)
  useEffect(() => {
    const fetchSites = async () => {
      try {
        const res = await fetch('/api/sites');
        const data = await res.json();
        if (data.success) {
          setSites(data.sites || []);
        }
      } catch {
        // silent
      }
    };
    fetchSites();
  }, []);

  useEffect(() => {
    fetchEmployee();
  }, [fetchEmployee]);

  // ── Handlers ──

  const handleBack = () => {
    setCurrentView('employees');
  };

  const handleWhatsApp = () => {
    if (!employee?.phone) {
      toast({ title: 'No Phone', description: 'No phone number available', variant: 'destructive' });
      return;
    }
    const phone = employee.phone.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/${phone}`, '_blank');
  };

  const handleDownloadCV = () => {
    if (!employee) return;
    setGeneratingPDF(true);
    try {
      generateEmployeeCV(employee, sites);
      toast({ title: 'CV Downloaded', description: `PDF CV for ${employee.fullName} has been generated.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to generate PDF', variant: 'destructive' });
    } finally {
      setTimeout(() => setGeneratingPDF(false), 500);
    }
  };

  const handleSaveQuickHours = async () => {
    if (!employee) return;
    const val = parseFloat(quickHoursValue);
    if (isNaN(val) || val < 0) {
      toast({ title: 'Invalid', description: 'Enter a valid number', variant: 'destructive' });
      return;
    }
    setQuickHoursSaving(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTotalWorkingHours: val }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Updated', description: 'Working hours updated successfully' });
        setEmployee({ ...employee, currentTotalWorkingHours: val });
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to update', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update hours', variant: 'destructive' });
    } finally {
      setQuickHoursSaving(false);
    }
  };

  // ── Loading state ──
  if (loading && !employee) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          <p className="text-sm text-slate-500">Loading employee details...</p>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto mb-3" />
          <p className="text-slate-400 mb-4">Employee not found</p>
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Employees
          </Button>
        </div>
      </div>
    );
  }

  const teamLeaderSite = employee.teamLeaderSiteId
    ? sites.find((s) => s.id === employee.teamLeaderSiteId)
    : null;
  const supervisorSite = employee.supervisorSiteId
    ? sites.find((s) => s.id === employee.supervisorSiteId)
    : null;

  return (
    <div className="space-y-4 pb-8">
      {/* ─── Top Bar: Back + Actions ─── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button
          variant="ghost"
          onClick={handleBack}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Employees
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleWhatsApp}
            disabled={!employee.phone}
            className="border-slate-700 text-slate-300 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/50"
          >
            <MessageCircle className="h-4 w-4 mr-1.5" />
            WhatsApp
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadCV}
            disabled={generatingPDF}
            className="border-slate-700 text-slate-300 hover:bg-blue-500/10 hover:text-blue-400 hover:border-blue-500/50"
          >
            {generatingPDF ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            Download CV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              useAppStore.getState().setCurrentView('employees');
              // Trigger edit — the employee page listens for this
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('editEmployee', { detail: employee.id }));
              }, 100);
            }}
            className="border-slate-700 text-slate-300 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/50"
          >
            <Pencil className="h-4 w-4 mr-1.5" />
            Edit
          </Button>
        </div>
      </div>

      {/* ─── Hero Header Card ─── */}
      <Card className="bg-gradient-to-br from-slate-800 to-slate-800/60 border-slate-700/50 overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Avatar */}
            <div className="h-20 w-20 rounded-2xl bg-blue-500/20 flex items-center justify-center flex-shrink-0 border border-blue-500/30">
              {employee.photo ? (
                <img
                  src={employee.photo}
                  alt={employee.fullName}
                  className="h-full w-full rounded-2xl object-cover"
                />
              ) : (
                <span className="text-2xl font-bold text-blue-400">
                  {getInitials(employee.fullName)}
                </span>
              )}
            </div>

            {/* Name + badges */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-2xl font-bold text-white">{employee.fullName}</h1>
                {employee.isTeamLeader && (
                  <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] px-2 py-0.5">
                    <Crown className="h-3 w-3 mr-0.5" />
                    Team Leader
                  </Badge>
                )}
                {employee.isSupervisor && (
                  <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/25 text-[10px] px-2 py-0.5">
                    <ShieldCheck className="h-3 w-3 mr-0.5" />
                    Supervisor
                  </Badge>
                )}
              </div>
              <p className="text-sm text-slate-400 font-mono mb-2">{employee.employeeId}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge status={employee.status} />
                {employee.trade && (
                  <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/25 text-[10px] px-2 py-0.5">
                    <Briefcase className="h-3 w-3 mr-0.5" />
                    {employee.trade}
                  </Badge>
                )}
                {employee.currentSite && (
                  <Badge className="bg-slate-700/50 text-slate-300 border-slate-600/50 text-[10px] px-2 py-0.5">
                    <Building2 className="h-3 w-3 mr-0.5" />
                    {employee.currentSite}
                  </Badge>
                )}
                {employee.rating > 0 && <StarRating rating={employee.rating} />}
              </div>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-col sm:items-end">
              {employee.customHourlyRate != null && (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Rate</p>
                  <p className="text-lg font-bold text-emerald-400">{employee.customHourlyRate} <span className="text-xs text-slate-400">AED/hr</span></p>
                </div>
              )}
              {employee.currentTotalWorkingHours != null && (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Total Hours</p>
                  <p className="text-lg font-bold text-blue-400">{employee.currentTotalWorkingHours.toLocaleString()}<span className="text-xs text-slate-400"> hrs</span></p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Content Grid ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Personal Information */}
        <SectionCard title="Personal Information" icon={User}>
          <div className="space-y-0.5">
            <InfoRow icon={CreditCard} label="Employee ID" value={employee.employeeId} />
            <InfoRow icon={Globe} label="Nationality" value={employee.nationality} />
            <InfoRow icon={Calendar} label="Date of Birth" value={formatDate(employee.dateOfBirth)} />
            <InfoRow icon={Phone} label="Phone" value={employee.phone} />
            <InfoRow icon={Mail} label="Email" value={employee.email} />
            <InfoRow icon={MapPin} label="Address" value={employee.address} />
            <InfoRow icon={Phone} label="Emergency Contact" value={employee.emergencyContact} />
          </div>
        </SectionCard>

        {/* Professional Information */}
        <SectionCard title="Professional Information" icon={Briefcase}>
          <div className="space-y-0.5">
            <InfoRow icon={Briefcase} label="Trade" value={employee.trade} />
            <InfoRow icon={User} label="Position" value={employee.position} />
            <InfoRow icon={Building2} label="Company" value={employee.companyName} />
            <InfoRow icon={Building2} label="Current Site" value={employee.currentSite} />
            <InfoRow icon={Calendar} label="Join Date" value={formatDate(employee.joinDate)} />
            <InfoRow icon={Star} label="Rating" value={employee.rating > 0 ? `${employee.rating} / 5` : '—'} />
            {employee.isTeamLeader && teamLeaderSite && (
              <InfoRow icon={Crown} label="Team Leader At" value={teamLeaderSite.name} />
            )}
            {employee.isSupervisor && supervisorSite && (
              <InfoRow icon={ShieldCheck} label="Supervisor At" value={supervisorSite.name} />
            )}
          </div>
        </SectionCard>

        {/* Identification Documents */}
        <SectionCard title="Identification Documents" icon={Shield}>
          <div className="space-y-0.5">
            <InfoRow icon={BookOpen} label="Passport Number" value={employee.passportNumber} />
            <InfoRow icon={Shield} label="Passport Status" value={employee.passportStatus} />
            <InfoRow icon={CreditCard} label="ID Number" value={employee.idNumber} />
            <InfoRow icon={Shield} label="ID Status" value={employee.idStatus} />
          </div>
        </SectionCard>

        {/* Work Configuration */}
        <SectionCard title="Work Configuration" icon={Clock}>
          <div className="space-y-3">
            <InfoRow
              icon={CreditCard}
              label="Custom Hourly Rate"
              value={employee.customHourlyRate != null ? `${employee.customHourlyRate} AED/hr` : '—'}
            />
            <InfoRow
              icon={Clock}
              label="Hours Threshold"
              value={employee.hoursThreshold ? `${employee.hoursThreshold} hrs` : '—'}
            />
            {/* Quick hours editor */}
            <div className="pt-3 border-t border-slate-700/50">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2 px-3">
                Current Total Working Hours
              </p>
              <div className="flex items-center gap-2 px-3">
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={quickHoursValue}
                  onChange={(e) => setQuickHoursValue(e.target.value)}
                  className="bg-slate-900 border-slate-600 text-white h-8 flex-1"
                  placeholder="0"
                />
                <Button
                  size="sm"
                  onClick={handleSaveQuickHours}
                  disabled={quickHoursSaving}
                  className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {quickHoursSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                </Button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5 px-3">
                Manually set the employee's running cumulative hours. Used as a starting balance.
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ─── Meta Info ─── */}
      <Card className="bg-slate-800/30 border-slate-700/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                Created: {formatDate(employee.createdAt)}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                Updated: {formatDate(employee.updatedAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-3 w-3" />
              <span>Employee Record</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
