'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth-store';

// ---------------------------------------------------------------------------
// usePresenceHeartbeat
// ---------------------------------------------------------------------------
// Sends a heartbeat to /api/presence/heartbeat every 30s while the user is
// logged in. This updates the user's lastSeenAt timestamp, which the Admin
// Management page uses to show an "online" green dot.
//
// The hook also sends an immediate heartbeat on mount and when the user
// becomes visible again (e.g. switching back to the tab).
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds

export function usePresenceHeartbeat() {
  const { user } = useAuthStore();
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;

    const sendHeartbeat = async () => {
      const uid = userIdRef.current;
      if (!uid) return;
      try {
        await fetch('/api/presence/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid }),
          keepalive: true,
        });
      } catch {
        // Network errors are non-fatal — we'll try again on the next tick
      }
    };

    // Send immediately on mount
    sendHeartbeat();

    // Then every 30s
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    // Also send when the tab becomes visible again
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user?.id]);
}
