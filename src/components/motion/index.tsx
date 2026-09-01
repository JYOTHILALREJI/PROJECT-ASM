'use client';

/**
 * ASM Motion System
 * -----------------
 * Reusable framer-motion primitives shared across the whole app so every
 * page animates with the same timing, easing and spring physics.
 *
 * Exports:
 *  - PageTransition      : fade + slide wrapper used for every view swap
 *  - StaggerContainer    : orchestrates children entering one-by-one
 *  - StaggerItem         : a single child inside a StaggerContainer
 *  - AnimatedNumber      : count-up numeric animation for stat cards
 *  - FadeIn              : simple one-shot fade/scale entrance
 *  - PulseDot            : live presence indicator
 *  - spring/springSoft   : shared physics constants
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, useInView, useMotionValue, useSpring, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Shared physics — one place to tune the "feel" of the entire app
// ---------------------------------------------------------------------------
export const spring = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 32,
  mass: 0.9,
};

export const springSoft = {
  type: 'spring' as const,
  stiffness: 260,
  damping: 26,
};

export const hoverLift = { y: -4, scale: 1.01 };
export const tapPress = { scale: 0.97 };

// ---------------------------------------------------------------------------
// PageTransition — wraps every main view; keyed by the view id upstream
// ---------------------------------------------------------------------------
export function PageTransition({
  children,
  className,
  ...props
}: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Stagger orchestration
// ---------------------------------------------------------------------------
export function StaggerContainer({
  children,
  className,
  stagger = 0.06,
  delay = 0,
  ...props
}: HTMLMotionProps<'div'> & { stagger?: number; delay?: number }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: { staggerChildren: stagger, delayChildren: delay },
        },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  ...props
}: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 18, scale: 0.98 },
        show: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: springSoft,
        },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// AnimatedNumber — smooth count-up for dashboard metrics
// ---------------------------------------------------------------------------
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = '',
  prefix = '',
  className,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, {
    stiffness: 90,
    damping: 24,
    mass: 0.8,
  });
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (inView) motionValue.set(value);
  }, [inView, value, motionValue]);

  useEffect(() => {
    const unsub = springValue.on('change', (latest: number) => {
      setDisplay(
        latest.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      );
    });
    return unsub;
  }, [springValue, decimals]);

  // Reset when value drops to 0 (e.g. switching months)
  useEffect(() => {
    if (value === 0) {
      motionValue.set(0);
    }
  }, [value, motionValue]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FadeIn — one-shot entrance for headers, sections, etc.
// ---------------------------------------------------------------------------
export function FadeIn({
  children,
  className,
  delay = 0,
  y = 12,
  ...props
}: HTMLMotionProps<'div'> & { delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// PulseDot — live presence indicator
// ---------------------------------------------------------------------------
export function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex h-2 w-2', className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}
