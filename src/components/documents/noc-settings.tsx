'use client';

/**
 * NocSettings — super-admin management for the NOC letter:
 *   1. Template  — controlled legal wording + default signatory block
 *   2. Companies — multiple issuing company names (+ optional letterhead
 *      image, manager name/phone/email printed in the NOC footer)
 *   3. Stamps    — the reusable stamp library stored in the database
 *      (upload images, set default, remove)
 */
import React from 'react';
import {
  Settings2,
  Save,
  Plus,
  Trash2,
  Building2,
  Stamp as StampIcon,
  Star,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import { toast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';
import { inputCls, type CompanyOption, type NocTemplateData, type StampOption } from '@/components/documents/shared';

// ---------------------------------------------------------------------------

function TemplateSection({ template, onSaved }: { template: NocTemplateData | null; onSaved: () => void }) {
  const { user } = useAuthStore();
  const [bodyText, setBodyText] = React.useState(template?.bodyText || '');
  const [companyName, setCompanyName] = React.useState(template?.companyName || '');
  const [contactPerson, setContactPerson] = React.useState(template?.contactPerson || '');
  const [contactPhone, setContactPhone] = React.useState(template?.contactPhone || '');
  const [contactEmail, setContactEmail] = React.useState(template?.contactEmail || '');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setBodyText(template?.bodyText || '');
      setCompanyName(template?.companyName || '');
      setContactPerson(template?.contactPerson || '');
      setContactPhone(template?.contactPhone || '');
      setContactEmail(template?.contactEmail || '');
    }, 0);
    return () => clearTimeout(t);
  }, [template]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/documents/noc-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyText, companyName, contactPerson, contactPhone, contactEmail, actorDisplayName: user?.name || user?.email }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      toast({ title: 'NOC template saved', description: 'New NOCs will use this wording and signatory block.' });
      onSaved();
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
      <div className="flex items-center gap-2 mb-1">
        <Settings2 className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">NOC Letter Template</h3>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Controlled legal wording. Use <code className="text-blue-300 bg-slate-900 px-1 rounded">{'{{company}}'}</code> where the bold issuing-company name should appear —
        it is replaced by the company chosen on each NOC.
      </p>
      <div className="space-y-3">
        <div className="space-y-1">
          <span className="text-xs font-medium text-slate-400">Body Text</span>
          <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={5} className={cn('resize-y', inputCls)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Fallback Company Name (when a NOC has no company)</span>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={cn('uppercase', inputCls)} />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Fallback Contact Person</span>
            <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Fallback Phone</span>
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Fallback Email</span>
            <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} />
          </div>
        </div>
        <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-500 text-white">
          <Save className="h-4 w-4 mr-2" /> {saving ? 'Saving…' : 'Save Template'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CompaniesSection({ companies, onChanged }: { companies: CompanyOption[]; onChanged: () => void }) {
  const { user } = useAuthStore();
  const [name, setName] = React.useState('');
  const [contactPerson, setContactPerson] = React.useState('Ms. Mafeeda Kader');
  const [contactPhone, setContactPhone] = React.useState('050 797 4153');
  const [contactEmail, setContactEmail] = React.useState('mafeedaarabianshieldmanpower@gmail.com');
  const [letterhead, setLetterhead] = React.useState<File | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<CompanyOption | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const add = async () => {
    if (name.trim().length < 3) {
      toast({ title: 'Company name required', description: 'At least 3 characters.', variant: 'destructive' });
      return;
    }
    setAdding(true);
    try {
      const form = new FormData();
      form.append('name', name.trim());
      form.append('contactPerson', contactPerson.trim());
      form.append('contactPhone', contactPhone.trim());
      form.append('contactEmail', contactEmail.trim());
      form.append('actorDisplayName', user?.name || user?.email || '');
      form.append('actorUserId', user?.id || '');
      if (letterhead) form.append('file', letterhead);
      const res = await fetch('/api/documents/companies', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      toast({ title: 'Company added', description: `${name.trim()} can now be chosen on NOCs.` });
      setName('');
      setLetterhead(null);
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to add company', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/documents/companies/${deleteTarget.id}?actorDisplayName=${encodeURIComponent(user?.name || user?.email || 'Admin')}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      toast({ title: 'Company removed', description: deleteTarget.name });
      setDeleteTarget(null);
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to remove company', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Issuing Companies</h3>
        <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-[10px]">{companies.length}</Badge>
      </div>
      <p className="text-xs text-slate-400 mb-4">More than one company name — every NOC picks its issuing company here. The manager name, number and email are printed in the NOC footer exactly like the reference letters; an optional letterhead image replaces the default ASM letterhead for that company.</p>

      <div className="space-y-2 mb-4">
        {companies.length === 0 && <div className="rounded-lg border border-dashed border-slate-700/70 px-3 py-4 text-center text-xs text-slate-500">No companies yet — add the first one below.</div>}
        {companies.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2.5">
            <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-slate-200 truncate">{c.name}</div>
              <div className="text-[11px] text-slate-400 truncate">
                {c.contactPerson} · {c.contactPhone} · {c.contactEmail}
                {c.letterheadPath ? ' · custom letterhead' : ' · default ASM letterhead'}
              </div>
            </div>
            <button type="button" title="Remove company" onClick={() => setDeleteTarget(c)} className="rounded p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Add company</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Company Name * (as printed)</span>
            <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="ARABIAN SHIELD A/C. UNITS FIX. CONT" className={cn('uppercase', inputCls)} />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Letterhead Image (optional)</span>
            <Input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => setLetterhead(e.target.files?.[0] || null)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Manager Name (footer)</span>
            <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Manager Number (footer)</span>
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <span className="text-xs font-medium text-slate-400">Manager Email (footer)</span>
            <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} />
          </div>
        </div>
        <Button onClick={add} disabled={adding} size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white">
          <Plus className="h-3.5 w-3.5 mr-1" /> {adding ? 'Adding…' : 'Add Company'}
        </Button>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Remove company &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              It will no longer be selectable on new NOCs. Already-issued NOCs keep their original printed copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-red-500 hover:bg-red-600 text-white border-0">
              <Trash2 className="h-4 w-4 mr-2" /> Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StampsSection({ stamps, companies, onChanged }: { stamps: StampOption[]; companies: CompanyOption[]; onChanged: () => void }) {
  const { user } = useAuthStore();
  const [name, setName] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [isDefault, setIsDefault] = React.useState(false);
  const [companyId, setCompanyId] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<StampOption | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const add = async () => {
    if (name.trim().length < 2) {
      toast({ title: 'Stamp name required', variant: 'destructive' });
      return;
    }
    if (!file) {
      toast({ title: 'Choose a stamp image', description: 'PNG or JPG scan of the stamp.', variant: 'destructive' });
      return;
    }
    setAdding(true);
    try {
      const form = new FormData();
      form.append('name', name.trim());
      if (isDefault) form.append('isDefault', '1');
      if (companyId) form.append('companyId', companyId);
      form.append('actorDisplayName', user?.name || user?.email || '');
      form.append('actorUserId', user?.id || '');
      form.append('file', file);
      const res = await fetch('/api/documents/stamps', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      toast({ title: 'Stamp added to the library', description: name.trim() });
      setName('');
      setFile(null);
      setIsDefault(false);
      setCompanyId('');
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to add stamp', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const makeDefault = async (stamp: StampOption) => {
    try {
      const res = await fetch(`/api/documents/stamps/${stamp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true, actorDisplayName: user?.name || user?.email, actorUserId: user?.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      toast({ title: `Default stamp: ${stamp.name}` });
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to set default', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/documents/stamps/${deleteTarget.id}?actorDisplayName=${encodeURIComponent(user?.name || user?.email || 'Admin')}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      toast({ title: 'Stamp removed', description: deleteTarget.name });
      setDeleteTarget(null);
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to remove stamp', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const stampThumb = (id: string) => `/api/documents/stamps/${id}/image`;

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
      <div className="flex items-center gap-2 mb-1">
        <StampIcon className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Stamp Library</h3>
        <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-[10px]">{stamps.length}</Badge>
      </div>
      <p className="text-xs text-slate-400 mb-4">Stamps are stored in the database — every NOC chooses WHICH stamp to use (and whether to stamp at all). The default stamp is pre-selected on new NOCs.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
        {stamps.length === 0 && <div className="rounded-lg border border-dashed border-slate-700/70 px-3 py-4 text-center text-xs text-slate-500 md:col-span-2">No stamps yet — the two reference stamps are available as defaults.</div>}
        {stamps.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2.5">
            <img src={stampThumb(s.id)} alt={s.name} className="h-12 w-16 object-contain rounded bg-white/90" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-slate-200 truncate">{s.name}</span>
                {s.isDefault && <Star className="h-3 w-3 text-amber-400 fill-amber-400" />}
              </div>
              <div className="text-[10px] text-slate-500">{s.isDefault ? 'Default for new NOCs' : 'Available in the stamp picker'}{s.companyName ? ` · ${s.companyName}` : ' · any company'}</div>
            </div>
            <div className="flex items-center gap-0.5">
              {!s.isDefault && (
                <button type="button" title="Make default" onClick={() => makeDefault(s)} className="rounded p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-700/60">
                  <Star className="h-3.5 w-3.5" />
                </button>
              )}
              <button type="button" title="Remove stamp" onClick={() => setDeleteTarget(s)} className="rounded p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Add stamp</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Stamp Name *</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Site stamp — Dubai" className={inputCls} />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Stamp Image * (PNG/JPG scan, max 5 MB)</span>
            <Input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className={inputCls} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <span className="text-xs font-medium text-slate-400">Belongs to company</span>
            <Select value={companyId || undefined} onValueChange={(v) => setCompanyId(v === '_any' ? '' : v)}>
              <SelectTrigger className={inputCls}><SelectValue placeholder="Any company (universal stamp)" /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                <SelectItem value="_any">Any company (universal stamp)</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-[10px] text-slate-500">A company stamp can only be applied to NOCs issued by the same company.</span>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-3.5 w-3.5 accent-blue-500" />
          Make this the default stamp for new NOCs
        </label>
        <Button onClick={add} disabled={adding} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white">
          <Upload className="h-3.5 w-3.5 mr-1" /> {adding ? 'Uploading…' : 'Add Stamp'}
        </Button>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Remove stamp &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              It disappears from the stamp picker. NOCs already issued keep the stamp image printed on them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-red-500 hover:bg-red-600 text-white border-0">
              <Trash2 className="h-4 w-4 mr-2" /> Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function NocSettings({
  template,
  companies,
  stamps,
  onTemplateSaved,
  onLibraryChanged,
}: {
  template: NocTemplateData | null;
  companies: CompanyOption[];
  stamps: StampOption[];
  onTemplateSaved: () => void;
  onLibraryChanged: () => void;
}) {
  return (
    <div className="max-w-3xl space-y-5">
      <TemplateSection template={template} onSaved={onTemplateSaved} />
      <CompaniesSection companies={companies} onChanged={onLibraryChanged} />
      <StampsSection stamps={stamps} companies={companies} onChanged={onLibraryChanged} />
    </div>
  );
}
