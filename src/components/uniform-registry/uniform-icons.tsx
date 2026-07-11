'use client';

import React from 'react';

// ---------------------------------------------------------------------------
// Professional SVG icons for uniform items.
// Each icon is a clean, line-style SVG that renders crisply at any size.
// The `checked` prop controls whether the icon is shown in color (checked)
// or muted gray (unchecked).
// ---------------------------------------------------------------------------

interface IconProps {
  className?: string;
  checked?: boolean;
}

const checkedColor = '#10b981'; // emerald-500
const uncheckedColor = '#64748b'; // slate-500

export function UniformIcon({ className = 'h-5 w-5', checked = false }: IconProps) {
  const color = checked ? checkedColor : uncheckedColor;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Shirt/jacket silhouette */}
      <path d="M8 3 L4 5 L5 8 L7 8 L7 21 L17 21 L17 8 L19 8 L20 5 L16 3 L14 5 L10 5 Z" />
      <path d="M10 5 L12 7 L14 5" />
      <path d="M7 8 L7 21" />
      <path d="M17 8 L17 21" />
    </svg>
  );
}

export function ShoesIcon({ className = 'h-5 w-5', checked = false }: IconProps) {
  const color = checked ? checkedColor : uncheckedColor;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Shoe silhouette */}
      <path d="M3 16 L3 14 C3 13 4 12 6 12 L9 12 L12 9 C13 8 14 8 15 8 L17 8 C19 8 21 10 21 13 L21 16 Z" />
      <path d="M3 16 L21 16 L21 18 L3 18 Z" />
      <path d="M9 12 L9 16" />
      <path d="M12 9 L12 16" />
    </svg>
  );
}

export function HelmetIcon({ className = 'h-5 w-5', checked = false }: IconProps) {
  const color = checked ? checkedColor : uncheckedColor;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Hard hat / helmet */}
      <path d="M3 17 C3 11 7 7 12 7 C17 7 21 11 21 17 Z" />
      <path d="M3 17 L21 17" />
      <path d="M10 7 L10 5 C10 4 11 4 12 4 C13 4 14 4 14 5 L14 7" />
      <path d="M12 7 L12 17" />
    </svg>
  );
}

export function BottleIcon({ className = 'h-5 w-5', checked = false }: IconProps) {
  const color = checked ? checkedColor : uncheckedColor;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Water bottle */}
      <path d="M9 3 L15 3 L15 6 L16 7 L16 20 C16 21 15 21 14 21 L10 21 C9 21 8 21 8 20 L8 7 L9 6 Z" />
      <path d="M8 11 L16 11" />
      <path d="M10 3 L10 5 L14 5 L14 3" />
    </svg>
  );
}

export function SafetyJacketIcon({ className = 'h-5 w-5', checked = false }: IconProps) {
  const color = checked ? checkedColor : uncheckedColor;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Safety vest with reflective stripes */}
      <path d="M8 3 L4 5 L5 8 L7 8 L7 21 L17 21 L17 8 L19 8 L20 5 L16 3 L12 6 L8 3 Z" />
      <path d="M7 12 L17 12" strokeWidth="2.5" />
      <path d="M7 16 L17 16" strokeWidth="2.5" />
    </svg>
  );
}

export function MattressIcon({ className = 'h-5 w-5', checked = false }: IconProps) {
  const color = checked ? checkedColor : uncheckedColor;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Mattress (bed) */}
      <path d="M2 12 C2 10 3 9 5 9 L19 9 C21 9 22 10 22 12 L22 15 L2 15 Z" />
      <path d="M2 15 L2 18" />
      <path d="M22 15 L22 18" />
      <path d="M5 12 L5 12.5" strokeWidth="2.5" />
      <path d="M9 12 L9 12.5" strokeWidth="2.5" />
      <path d="M13 12 L13 12.5" strokeWidth="2.5" />
      <path d="M17 12 L17 12.5" strokeWidth="2.5" />
    </svg>
  );
}

export function PillowIcon({ className = 'h-5 w-5', checked = false }: IconProps) {
  const color = checked ? checkedColor : uncheckedColor;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Pillow */}
      <path d="M3 10 C3 8 5 7 8 7 L16 7 C19 7 21 8 21 10 L21 14 C21 16 19 17 16 17 L8 17 C5 17 3 16 3 14 Z" />
      <path d="M5 9 L5 15" strokeWidth="1" opacity="0.5" />
      <path d="M19 9 L19 15" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

// Master config — maps item key to { label, icon component }
export const UNIFORM_ITEM_ICONS: Record<string, { label: string; icon: React.ElementType }> = {
  uniform: { label: 'Uniform', icon: UniformIcon },
  shoes: { label: 'Shoes', icon: ShoesIcon },
  helmet: { label: 'Helmet', icon: HelmetIcon },
  bottle: { label: 'Water Bottle', icon: BottleIcon },
  safetyJacket: { label: 'Safety Jacket', icon: SafetyJacketIcon },
  mattress: { label: 'Mattress', icon: MattressIcon },
  pillow: { label: 'Pillow', icon: PillowIcon },
};

// Render a grid of uniform item icons with check/uncheck state
export function UniformItemsGrid({ items, size = 'sm' }: { items: Record<string, boolean>; size?: 'sm' | 'md' | 'lg' }) {
  const iconClass = size === 'lg' ? 'h-7 w-7' : size === 'md' ? 'h-6 w-6' : 'h-4 w-4';
  const labelClass = size === 'lg' ? 'text-xs' : 'text-[10px]';

  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(UNIFORM_ITEM_ICONS).map(([key, { label, icon: Icon }]) => {
        const checked = items[key] === true;
        return (
          <div
            key={key}
            className={`
              flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors
              ${checked
                ? 'border-emerald-500/30 bg-emerald-500/10'
                : 'border-slate-700/50 bg-slate-800/30'
              }
            `}
            title={`${label}: ${checked ? 'Issued' : 'Not issued'}`}
          >
            <Icon className={iconClass} checked={checked} />
            {size !== 'sm' && (
              <span className={`${labelClass} ${checked ? 'text-emerald-400' : 'text-slate-500'}`}>
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
