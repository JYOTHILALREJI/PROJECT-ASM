'use client';

import React, { useState } from 'react';
import { User, Mail, Shield, Lock, Eye, EyeOff, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/store/auth-store';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export function ProfilePage() {
  const { user } = useAuthStore();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!user) return null;

  async function handlePasswordUpdate() {
    const newErrors: Record<string, string> = {};
    if (!currentPassword) {
      newErrors.currentPassword = 'Current password is required';
    }
    if (!newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (newPassword.length < 6) {
      newErrors.newPassword = 'New password must be at least 6 characters';
    }
    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your new password';
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/user/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          currentPassword,
          newPassword,
        }),
      });
      const json = await res.json();

      if (json.success) {
        toast({
          title: 'Password Updated',
          description: 'Your password has been changed successfully.',
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setErrors({});
      } else {
        toast({
          title: 'Error',
          description: json.error || 'Failed to update password',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to connect to the server',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Profile</h2>
        <p className="text-slate-400 mt-1">
          Manage your account information and security settings.
        </p>
      </div>

      {/* User Info Card */}
      <Card className="bg-slate-800/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-base text-white flex items-center gap-2">
            <User className="h-4 w-4 text-blue-400" />
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold text-xl shrink-0">
              {user.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-lg font-semibold text-white">{user.name}</span>
              <div className="flex items-center gap-1.5 text-sm text-slate-400">
                <Mail className="h-3.5 w-3.5 text-slate-500" />
                {user.email}
              </div>
              <Badge
                variant="secondary"
                className={cn(
                  "mt-1 w-fit text-[10px] px-1.5 py-0 h-5",
                  user.role === 'super_admin'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                    : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                )}
              >
                {user.role === 'super_admin' ? (
                  <span className="flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    Super Admin
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    Admin
                  </span>
                )}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password Card */}
      <Card className="bg-slate-800/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-400" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Password */}
          <div className="space-y-2">
            <Label htmlFor="current-password" className="text-slate-300">
              Current Password <span className="text-red-400">*</span>
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                id="current-password"
                type={showCurrentPassword ? 'text' : 'password'}
                placeholder="Enter current password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  if (errors.currentPassword) setErrors((prev) => ({ ...prev, currentPassword: '' }));
                }}
                className="pl-9 pr-10 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-blue-500/30 focus:border-blue-500/50"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-slate-500 hover:text-slate-300"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              >
                {showCurrentPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {errors.currentPassword && (
              <p className="text-xs text-red-400">{errors.currentPassword}</p>
            )}
          </div>

          <Separator className="bg-slate-700/50" />

          {/* New Password */}
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-slate-300">
              New Password <span className="text-red-400">*</span>
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                id="new-password"
                type={showNewPassword ? 'text' : 'password'}
                placeholder="Enter new password (min 6 chars)"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (errors.newPassword) setErrors((prev) => ({ ...prev, newPassword: '' }));
                }}
                className="pl-9 pr-10 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-blue-500/30 focus:border-blue-500/50"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-slate-500 hover:text-slate-300"
                onClick={() => setShowNewPassword(!showNewPassword)}
              >
                {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {errors.newPassword && (
              <p className="text-xs text-red-400">{errors.newPassword}</p>
            )}
          </div>

          {/* Confirm New Password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-slate-300">
              Confirm New Password <span className="text-red-400">*</span>
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: '' }));
                }}
                className="pl-9 pr-10 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:ring-blue-500/30 focus:border-blue-500/50"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-slate-500 hover:text-slate-300"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {errors.confirmPassword && (
              <p className="text-xs text-red-400">{errors.confirmPassword}</p>
            )}
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <Button
              onClick={handlePasswordUpdate}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Updating...
                </span>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Update Password
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

