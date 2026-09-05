import { db } from '@/lib/db';

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
