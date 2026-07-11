import { db } from '@/lib/db';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Activity logger
// ---------------------------------------------------------------------------
// Every mutating action in the app (create/update/delete on any entity) is
// recorded as an ActivityLog row. This is the audit trail shown on the
// "All Logs" sidebar page, grouped by user.
//
// Usage from an API route:
//   await logActivity({
//     userId: '...',            // optional — null for system actions
//     displayName: 'John Doe',  // name if set, else email
//     action: 'mark_attendance',
//     entityType: 'attendance',
//     entityId: 'emp-123',
//     entityName: 'John Doe',
//     description: 'Marked John Doe as present for 2026-07-15',
//     details: { date: '2026-07-15', status: 'present' },
//     request,                  // optional — extracts IP + user agent
//   });
//
// The helper never throws — a logging failure should NOT break the parent
// operation. Errors are logged to console.error instead.
// ---------------------------------------------------------------------------

export interface LogActivityParams {
  userId?: string | null;
  displayName?: string | null;
  actorType?: string; // 'user' (default) | 'system' — override for system-generated actions
  action: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  description: string;
  details?: Record<string, unknown> | null;
  request?: NextRequest | null;
}

/**
 * Resolve the display name for a user. Prefers User.name, falls back to
 * User.email. Returns 'System' if the user doesn't exist (e.g. stale ID).
 */
export async function resolveDisplayName(userId: string | null | undefined): Promise<string> {
  if (!userId) return 'System';
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user) return 'Unknown user';
    return user.name || user.email || 'Unknown user';
  } catch {
    return 'Unknown user';
  }
}

/**
 * Extract the client IP address from a NextRequest. Checks the standard
 * forwarded-headers first (x-forwarded-for, x-real-ip), then falls back to
 * the request's remote address.
 */
function extractIpAddress(request?: NextRequest | null): string | null {
  if (!request) return null;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return null;
}

function extractUserAgent(request?: NextRequest | null): string | null {
  if (!request) return null;
  return request.headers.get('user-agent') || null;
}

/**
 * Write an ActivityLog row. Never throws — failures are logged to stderr.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const {
      userId,
      displayName,
      action,
      entityType,
      entityId,
      entityName,
      description,
      details,
      request,
    } = params;

    const name = displayName || (await resolveDisplayName(userId));
    const actorType = params.actorType || (userId ? 'user' : 'system');

    await db.activityLog.create({
      data: {
        userId: userId || null,
        displayName: name,
        actorType,
        action,
        entityType,
        entityId: entityId || null,
        entityName: entityName || null,
        description,
        details: details ? JSON.stringify(details) : null,
        ipAddress: extractIpAddress(request),
        userAgent: extractUserAgent(request),
      },
    });
  } catch (err) {
    // Logging must never break the parent operation
    console.error('[logActivity] failed:', err);
  }
}

/**
 * Convenience: log a login action. Called from the login API route.
 */
export async function logLogin(userId: string, displayName: string, request?: NextRequest | null): Promise<void> {
  await logActivity({
    userId,
    displayName,
    action: 'login',
    entityType: 'user',
    entityId: userId,
    entityName: displayName,
    description: `${displayName} logged in`,
    request,
  });
}

/**
 * Convenience: log a logout action.
 */
export async function logLogout(userId: string | null, displayName: string, request?: NextRequest | null): Promise<void> {
  await logActivity({
    userId,
    displayName,
    action: 'logout',
    entityType: 'user',
    entityId: userId || undefined,
    entityName: displayName,
    description: `${displayName} logged out`,
    request,
  });
}
