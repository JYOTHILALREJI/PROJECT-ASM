'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Building2, Briefcase, Search, X, Plus } from 'lucide-react';

// ─── Company Names (for dropdown) ─────────────────────────────────────────

export const COMPANY_NAMES = [
  'JSER ALNUHAS CONCRETE CARPENTER CONT',
  'HADEQAT AL RAMAQIA SANITARY CONT',
  'JSER AL HAYAT WATERPROOFING AND INSULATION CONT',
  'AL DARAA AL ARABI PLASTER & TILES CONT',
  'ARABIAN SHIELD A/C. UNITS FIX CONT',
  'NASEEM AL SHATEE A/C UNIT FIX CONT',
  'COLORFUL TRACK PAINTS CONT',
];

export const COMMON_TRADES = [
  'Helper', 'Mason', 'Electrician', 'Plumber', 'Welder', 'Carpenter',
  'Painter', 'Steel Fixer', 'Tile Fixer', 'Driver', 'Cleaner',
  'Foreman', 'Surveyor', 'Mechanic', 'Operator', 'Scaffolder',
  'Concrete Worker', 'Insulation Worker', 'Waterproofing Worker',
  'AC Technician', 'Duct Man', 'Pipe Fitter', 'Rigger', 'Store Keeper',
];

// ─── Searchable Company Name Dropdown ──────────────────────────────────────

interface SearchableCompanySelectProps {
  value: string;
  onChange: (value: string) => void;
  additionalOptions?: string[];
}

export function SearchableCompanySelect({
  value,
  onChange,
  additionalOptions = [],
}: SearchableCompanySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Merge predefined + additional (from DB) + current value if not in list
  const allOptions = useMemo(() => {
    const merged = [...new Set([...COMPANY_NAMES, ...additionalOptions])];
    if (value && !merged.includes(value)) {
      merged.push(value);
    }
    return merged.sort();
  }, [value, additionalOptions]);

  const filtered = search
    ? allOptions.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
    : allOptions;

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

  const handleSelect = (company: string) => {
    onChange(company);
    setOpen(false);
    setSearch('');
  };

  const handleCustomInput = () => {
    if (search.trim()) {
      onChange(search.trim());
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 w-full h-10 rounded-lg border border-slate-600 bg-slate-900 px-3 pl-10 text-sm text-white hover:bg-slate-800 transition-colors text-left"
        >
          <span className="truncate flex-1">{value || 'Select company name'}</span>
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="text-slate-400 hover:text-white shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      </div>

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
                placeholder="Search company or type new..."
                className="w-full h-8 pl-8 pr-3 bg-slate-900 border border-slate-600 rounded-md text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomInput();
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500">
                No matching companies. Press Enter to add &quot;{search}&quot;.
              </div>
            ) : (
              filtered.map((company) => (
                <button
                  key={company}
                  type="button"
                  onClick={() => handleSelect(company)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-slate-700/50 ${
                    value === company ? 'bg-slate-700/70 text-white' : 'text-slate-300'
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{company}</span>
                </button>
              ))
            )}
            {search.trim() && !filtered.some(c => c.toLowerCase() === search.toLowerCase()) && (
              <button
                type="button"
                onClick={handleCustomInput}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left border-t border-slate-700 text-emerald-400 hover:bg-slate-700/50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add &quot;{search}&quot; as custom company</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Searchable Trade Dropdown ────────────────────────────────────────────

interface SearchableTradeSelectProps {
  value: string;
  onChange: (value: string) => void;
  additionalOptions?: string[];
}

export function SearchableTradeSelect({
  value,
  onChange,
  additionalOptions = [],
}: SearchableTradeSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Merge predefined + additional (from DB) + current value if not in list
  const allOptions = useMemo(() => {
    const merged = [...new Set([...COMMON_TRADES, ...additionalOptions])];
    if (value && !merged.includes(value)) {
      merged.push(value);
    }
    return merged.sort();
  }, [value, additionalOptions]);

  const filtered = search
    ? allOptions.filter((t) => t.toLowerCase().includes(search.toLowerCase()))
    : allOptions;

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

  const handleSelect = (trade: string) => {
    onChange(trade);
    setOpen(false);
    setSearch('');
  };

  const handleCustomInput = () => {
    if (search.trim()) {
      onChange(search.trim());
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 w-full h-10 rounded-lg border border-slate-600 bg-slate-900 px-3 pl-10 text-sm text-white hover:bg-slate-800 transition-colors text-left"
        >
          <span className="truncate flex-1">{value || 'Select or type trade'}</span>
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="text-slate-400 hover:text-white shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      </div>

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
                placeholder="Search trade or type custom..."
                className="w-full h-8 pl-8 pr-3 bg-slate-900 border border-slate-600 rounded-md text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomInput();
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500">
                No matching trades. Press Enter to add &quot;{search}&quot;.
              </div>
            ) : (
              filtered.map((trade) => (
                <button
                  key={trade}
                  type="button"
                  onClick={() => handleSelect(trade)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-slate-700/50 ${
                    value === trade ? 'bg-slate-700/70 text-white' : 'text-slate-300'
                  }`}
                >
                  <Briefcase className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{trade}</span>
                </button>
              ))
            )}
            {search.trim() && !filtered.some(t => t.toLowerCase() === search.toLowerCase()) && (
              <button
                type="button"
                onClick={handleCustomInput}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left border-t border-slate-700 text-emerald-400 hover:bg-slate-700/50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add &quot;{search}&quot; as custom trade</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
