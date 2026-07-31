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
// The hook also:
//   - Sends an immediate heartbeat on mount
//   - Sends when the tab becomes visible again
//   - Sends a "going offline" signal on pagehide/beforeunload so the user
//     is marked offline IMMEDIATELY when they close the tab (instead of
//     waiting for the heartbeat to expire)
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
    const uid = user.id;

    const sendHeartbeat = async (goingOffline = false) => {
      try {
        const body: Record<string, unknown> = { userId: uid };
        if (goingOffline) body.goingOffline = true;
        await fetch('/api/presence/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        });
      } catch {
        // Network errors are non-fatal
      }
    };

    // Send immediately on mount
    sendHeartbeat();

    // Then every 30s
    const interval = setInterval(() => sendHeartbeat(false), HEARTBEAT_INTERVAL_MS);

    // Send when the tab becomes visible again
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ── Mark as offline immediately when the tab is closed ──
    // The pagehide event fires when the user navigates away or closes the tab.
    // We send a special heartbeat with goingOffline=true, which sets
    // lastSeenAt to 1 hour ago — making the user appear offline instantly
    // instead of waiting for the 35s threshold to expire.
    //
    // We use keepalive: true so the request completes even if the page
    // is being unloaded. We also try beforeunload as a fallback for
    // older browsers.
    const onUnload = () => {
      sendHeartbeat(true);
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [user?.id]);
}
