import { NextRequest, NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity-logger';
import { getNocTemplate, upsertNocTemplate } from '@/lib/noc-template';

// ---------------------------------------------------------------------------
// /api/documents/noc-template
//   GET — current NOC letter configuration (body text, company, signatory)
//   PUT — update it (admin action; legal wording stays controlled here)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const template = await getNocTemplate();
    return NextResponse.json({ success: true, data: { template } });
  } catch (error) {
    console.error('GET /api/documents/noc-template error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load NOC template' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      bodyText?: string;
      companyName?: string;
      contactPerson?: string;
      contactPhone?: string;
      contactEmail?: string;
      actorDisplayName?: string;
    };
    const template = await upsertNocTemplate(body);

    await logActivity({
      displayName: body.actorDisplayName || 'Admin',
      action: 'noc_template_update',
      entityType: 'noc_template',
      entityId: 'singleton',
      entityName: 'Default NOC Template',
      description: 'Updated the NOC letter template (body/signatory configuration)',
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { template } });
  } catch (error) {
    console.error('PUT /api/documents/noc-template error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update NOC template' }, { status: 500 });
  }
}
