import { NextRequest, NextResponse } from 'next/server';
import { generateNocPdf, type NocEmployeeRow } from '@/lib/noc-pdf';
import { resolveNocAssets } from '@/lib/noc-pdf-server';

// ---------------------------------------------------------------------------
// POST /api/documents/noc/preview
//   Generates a NOC PDF from the posted (unsaved) payload and returns it
//   inline — used by the NOC builder's "Preview" button so the admin can
//   check the letter before saving it into the archive.
//   Body: same payload as POST /api/documents/noc (company/stamp included).
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      clientName?: string;
      projectName?: string;
      clientAddress?: string;
      nocDate?: string;
      contactPerson?: string;
      contactPhone?: string;
      contactEmail?: string;
      stampType?: string;
      stampEnabled?: boolean;
      stampId?: string | null;
      companyId?: string | null;
      bodyText?: string;
      companyName?: string;
      employees?: Array<Partial<NocEmployeeRow>>;
    };

    const clientName = (body.clientName || '').trim().toUpperCase() || 'UNSPECIFIED CLIENT';
    const employees: NocEmployeeRow[] = (Array.isArray(body.employees) ? body.employees : []).map((row) => ({
      name: (row?.name || '').toString().trim().toUpperCase(),
      trade: (row?.trade || '').toString().trim().toUpperCase(),
      company: (row?.company || '').toString().trim().toUpperCase(),
      nationality: (row?.nationality || '').toString().trim().toUpperCase(),
      passport: (row?.passport || '').toString().trim().toUpperCase(),
    }));

    const assets = await resolveNocAssets({
      companyId: body.companyId || null,
      stampId: body.stampId || null,
      stampEnabled: body.stampEnabled,
      stampType: body.stampType || 'procurement',
      contactPerson: (body.contactPerson || '').trim() || null,
      contactPhone: (body.contactPhone || '').trim() || null,
      contactEmail: (body.contactEmail || '').trim() || null,
    });

    const pdfBytes = await generateNocPdf({
      clientName,
      projectName: (body.projectName || '').trim().toUpperCase(),
      clientAddress: (body.clientAddress || '').trim(),
      nocDate: (body.nocDate || '').trim(),
      contactPerson: assets.contactPerson,
      contactPhone: assets.contactPhone,
      contactEmail: assets.contactEmail,
      stampType: body.stampType || 'procurement',
      stampEnabled: assets.stampEnabled,
      stampImagePath: assets.stampImagePath,
      letterheadPath: assets.letterheadPath,
      employees,
      bodyText: body.bodyText || assets.bodyText,
      companyName: body.companyName || assets.companyName,
    });

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="NOC-preview.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('POST /api/documents/noc/preview error:', error);
    return NextResponse.json({ success: false, error: 'Failed to generate NOC preview' }, { status: 500 });
  }
}
