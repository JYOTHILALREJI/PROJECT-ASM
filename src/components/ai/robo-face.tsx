'use client';

import React, { useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * RoboFace — an animated SVG robot head used as the floating AI assistant.
 *
 * Animation features:
 *  - idle bobbing float + pulsing antenna glow
 *  - blinking eyes (staggered CSS keyframes)
 *  - pupils that smoothly track the cursor (spring-damped, ±3px)
 *  - waveform mouth bars (idle murmur / fast thinking / speaking)
 *  - "thinking" state swaps the eyes for spinning radar arcs
 *
 * Pure presentation: it never positions itself — the parent (RoboAssistant)
 * handles dragging and placement.
 */
export type RoboStatus = 'idle' | 'thinking' | 'speaking';

interface RoboFaceProps {
  size?: number;
  status?: RoboStatus;
  className?: string;
}

export function RoboFace({ size = 72, status = 'idle', className }: RoboFaceProps) {
  const rootRef = useRef<SVGSVGElement | null>(null);

  // Cursor tracking — springs keep it buttery smooth without re-renders.
  const pupilX = useMotionValue(0);
  const pupilY = useMotionValue(0);
  const smoothX = useSpring(pupilX, { stiffness: 140, damping: 14, mass: 0.4 });
  const smoothY = useSpring(pupilY, { stiffness: 140, damping: 14, mass: 0.4 });

  useEffect(() => {
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = rootRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) / (rect.width || 1);
        const dy = (e.clientY - cy) / (rect.height || 1);
        // Clamp to a subtle ±3px wander.
        pupilX.set(Math.max(-1, Math.min(1, dx * 2)) * 3);
        pupilY.set(Math.max(-1, Math.min(1, dy * 2)) * 3);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pupilX, pupilY]);

  const thinking = status === 'thinking';

  return (
    <motion.div
      className={cn('asm-robo-float select-none', className)}
      style={{ width: size, height: size }}
      animate={status === 'speaking' ? { scale: [1, 1.04, 1] } : { scale: 1 }}
      transition={status === 'speaking' ? { repeat: Infinity, duration: 0.9, ease: 'easeInOut' } : { duration: 0.2 }}
    >
      <svg
        ref={rootRef}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="AI assistant"
      >
        <defs>
          <linearGradient id="asm-robo-shell" x1="15" y1="8" x2="85" y2="92" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f1f5f9" />
            <stop offset="0.45" stopColor="#cbd5e1" />
            <stop offset="1" stopColor="#7c8ba1" />
          </linearGradient>
          <linearGradient id="asm-robo-screen" x1="20" y1="25" x2="80" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0b1220" />
            <stop offset="1" stopColor="#16233b" />
          </linearGradient>
          <radialGradient id="asm-robo-eye-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#67e8f9" stopOpacity="0.9" />
            <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="asm-robo-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.65" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.25" />
          </linearGradient>
          <filter id="asm-robo-blur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>

        {/* Ground glow */}
        <ellipse cx="50" cy="94" rx="26" ry="4" fill="#0ea5e9" opacity="0.18" filter="url(#asm-robo-blur)" />

        {/* Antenna */}
        <rect x="48.6" y="6" width="2.8" height="12" rx="1.4" fill="#94a3b8" />
        <circle cx="50" cy="5.5" r="4.6" fill="#22d3ee" opacity="0.28" filter="url(#asm-robo-blur)">
          <animate attributeName="opacity" values="0.15;0.5;0.15" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="50" cy="5.5" r="2.6" fill="#67e8f9">
          <animate attributeName="fill" values="#67e8f9;#a5f3fc;#67e8f9" dur="2.4s" repeatCount="indefinite" />
        </circle>

        {/* Ear pods */}
        <rect x="7" y="42" width="9" height="18" rx="4.5" fill="url(#asm-robo-shell)" stroke="#64748b" strokeOpacity="0.5" />
        <rect x="84" y="42" width="9" height="18" rx="4.5" fill="url(#asm-robo-shell)" stroke="#64748b" strokeOpacity="0.5" />

        {/* Head shell */}
        <rect x="14" y="12" width="72" height="70" rx="22" fill="url(#asm-robo-shell)" stroke="#64748b" strokeOpacity="0.55" strokeWidth="1.2" />
        {/* Glossy rim highlight */}
        <rect x="16.5" y="14" width="67" height="66" rx="20" fill="url(#asm-robo-rim)" opacity="0.5" />

        {/* Face screen */}
        <rect x="22" y="21" width="56" height="46" rx="15" fill="url(#asm-robo-screen)" stroke="#0f172a" strokeWidth="1" />
        <rect x="24" y="23" width="52" height="20" rx="12" fill="#ffffff" opacity="0.045" />

        {/* ── Eyes ── */}
        {thinking ? (
          <g>
            {/* Radar arcs while thinking */}
            <g className="asm-robo-spin" style={{ transformOrigin: '37px 42px' }}>
              <circle cx="37" cy="42" r="7.5" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" strokeDasharray="30 18" fill="none" />
            </g>
            <g className="asm-robo-spin-reverse" style={{ transformOrigin: '63px 42px' }}>
              <circle cx="63" cy="42" r="7.5" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" strokeDasharray="30 18" fill="none" />
            </g>
          </g>
        ) : (
          <>
            {/* Eye glows */}
            <ellipse cx="37" cy="42" rx="9.5" ry="9.5" fill="url(#asm-robo-eye-glow)" />
            <ellipse cx="63" cy="42" rx="9.5" ry="9.5" fill="url(#asm-robo-eye-glow)" />
            <motion.g style={{ x: smoothX, y: smoothY }}>
              {/* Pupils (blink via scaleY keyframes on the group) */}
              <g className="asm-robo-eye">
                <ellipse cx="37" cy="42" rx="4.6" ry="5.2" fill="#67e8f9" />
                <circle cx="35.4" cy="40.2" r="1.5" fill="#ffffff" opacity="0.9" />
              </g>
              <g className="asm-robo-eye asm-robo-eye-delay">
                <ellipse cx="63" cy="42" rx="4.6" ry="5.2" fill="#67e8f9" />
                <circle cx="61.4" cy="40.2" r="1.5" fill="#ffffff" opacity="0.9" />
              </g>
            </motion.g>
          </>
        )}

        {/* ── Mouth: waveform bars ── */}
        <g>
          {[0, 1, 2, 3, 4].map((i) => {
            const x = 40 + i * 5;
            const delays = ['0s', '0.18s', '0.36s', '0.54s', '0.72s'];
            const speeds = status === 'thinking' ? '0.5s' : status === 'speaking' ? '0.55s' : '2.6s';
            return (
              <rect
                key={i}
                className="asm-robo-bar"
                x={x}
                y={56}
                width="3.2"
                height="10"
                rx="1.6"
                fill={thinking ? '#38bdf8' : '#22d3ee'}
                opacity={0.9}
                style={{ transformOrigin: `${x + 1.6}px 61px`, animationDelay: delays[i], animationDuration: speeds }}
              />
            );
          })}
        </g>

        {/* Chin light */}
        <rect x="42" y="72" width="16" height="3.6" rx="1.8" fill="#475569" opacity="0.85" />
        <circle cx="50" cy="73.8" r="1.2" fill={status === 'thinking' ? '#f59e0b' : '#22d3ee'}>
          <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </motion.div>
  );
}
