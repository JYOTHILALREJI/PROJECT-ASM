import { db } from '@/lib/db';
import { AGENT_VIEWS, RESTRICTED_VIEWS, SUPER_ADMIN_ONLY_VIEWS, VIEW_LABELS, permissionSlugForView } from '@/lib/app-ui-map';

// AI Assistant access gate.
//
// The AI assistant is PERMISSION-BASED: super admins always have it, and a
// normal admin can use it only when the super admin grants the "AI Assistant"
// (slug: ai_assistant) permission from Admin Management. The grant lives in
// the standard Permission/AdminPermission system (with the legacy
// AdminMenuPermission table honoured for backward compatibility), so it shows
// up in the same permission grid as every other menu.
//
// Both AI endpoints (/api/ai/chat, /api/ai/sessions) call assertAiAllowed()
// before doing any work, and the frontend hides the assistant face entirely
// for accounts without the grant — revoking mid-session takes effect within
// seconds (the sidebar permission poll refreshes every 15s).

export async function isAiAllowed(userId: string): Promise<boolean> {
  if (!userId) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return false;
  if (user.role === 'super_admin') return true;

  const [grant, legacy] = await Promise.all([
    db.adminPermission.findFirst({
      where: {
        adminId: userId,
        deletedAt: null,
        permission: { slug: 'ai_assistant', deletedAt: null },
      },
      select: { id: true },
    }),
    db.adminMenuPermission.findFirst({
      where: { userId, menuKey: 'ai_assistant', allowed: true, deletedAt: null },
      select: { id: true },
    }),
  ]);
  return !!grant || !!legacy;
}

export const AI_ACCESS_DENIED = 'The AI assistant is not enabled for your account. Ask the super admin to turn on the "AI Assistant" permission in Admin Management.';

/**
 * Which app screens may THIS user's AI agent open? Mirrors the human UI rules
 * (page.tsx isViewAllowed): super admins can open everything; a normal admin
 * gets the always-visible screens plus the restricted ones they were granted,
 * and Settings / Admin Management are super-admin-only outright (their save
 * APIs reject non-super-admins anyway).
 *
 * Returns the denied views as human labels so the planner can be told — in one
 * line — where it must refuse to go and SAY so instead of failing mid-task.
 */
export async function getUserAccess(userId: string): Promise<{ isSuperAdmin: boolean; deniedViews: string[] }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return { isSuperAdmin: false, deniedViews: [...AGENT_VIEWS] };
  if (user.role === 'super_admin') return { isSuperAdmin: true, deniedViews: [] };

  const [grants, legacy] = await Promise.all([
    db.adminPermission.findMany({
      where: { adminId: userId, deletedAt: null, permission: { deletedAt: null } },
      select: { permission: { select: { slug: true } } },
    }),
    db.adminMenuPermission.findMany({
      where: { userId, allowed: true, deletedAt: null },
      select: { menuKey: true },
    }),
  ]);
  const granted = new Set<string>([...grants.map((g) => g.permission.slug), ...legacy.map((l) => l.menuKey)]);

  const deniedViews = AGENT_VIEWS.filter((view) => {
    if (SUPER_ADMIN_ONLY_VIEWS.includes(view)) return true;
    if (!RESTRICTED_VIEWS.includes(view)) return false;
    return !granted.has(permissionSlugForView(view));
  });
  return { isSuperAdmin: false, deniedViews: deniedViews.map((v) => VIEW_LABELS[v] ?? v) };
}
