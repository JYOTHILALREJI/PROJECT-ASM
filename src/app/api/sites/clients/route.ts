import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/sites/clients
// ---------------------------------------------------------------------------
// Returns the distinct, non-empty, non-deleted client names from the Site
// table, sorted alphabetically. Used by the Sites page's Add/Edit dialog to
// populate the "Client Name" combobox with an option to add a new client.
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const sites = await db.site.findMany({
      where: {
        deletedAt: null,
        clientName: { not: null },
      },
      select: { clientName: true },
      orderBy: { clientName: 'asc' },
    });

    // Distinct + trimmed + non-empty
    const seen = new Set<string>();
    const clients: string[] = [];
    for (const s of sites) {
      const name = (s.clientName || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clients.push(name);
    }
    clients.sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      success: true,
      data: { clients },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
