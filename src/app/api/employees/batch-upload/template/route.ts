import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// GET /api/employees/batch-upload/template?format=csv|tsv|xlsx|json
// ---------------------------------------------------------------------------
// Returns a small example file in the requested format showing the expected
// column headers and a couple of sample rows. Used by the Batch Add dialog's
// "Download sample" button.
// ---------------------------------------------------------------------------

const SAMPLE_HEADERS = [
  'Full Name',
  'Nationality',
  'Date of Birth',
  'Phone',
  'Email',
  'Trade',
  'Join Date',
  'Company Name',
  'Passport Number',
  'Passport Status',
  'ID Number',
  'ID Status',
  'Current Site',
  'Address',
  'Emergency Contact',
  'Employee ID',
  'Role',
  'Custom Hourly Rate',
];

const SAMPLE_ROWS: (string | number)[][] = [
  ['John Doe', 'Indian', '1990-05-12', '+971501234567', 'john.doe@example.com', 'Mason', '2024-01-15', 'ASM Contracting', 'A1234567', 'Valid', 'ID7890', 'Valid', 'Site A', 'Dubai, UAE', '+971509876543', 'ASM-2024-001', 'Standard', ''],
  ['Ahmed Ali', 'Pakistani', '1988-09-23', '+971502345678', 'ahmed.ali@example.com', 'Electrician', '2024-02-01', 'ASM Contracting', 'B7654321', 'Expired', 'ID4567', 'Pending', 'Site B', 'Sharjah, UAE', '+971501234500', 'ASM-2024-002', 'Team Leader', '3.0'],
  ['Ravi Kumar', 'Indian', '1992-12-01', '+971503456789', 'ravi.kumar@example.com', 'Welder', '2024-03-10', 'ASM Contracting', 'C9876543', 'Valid', 'ID1234', 'Valid', 'Site A', 'Abu Dhabi, UAE', '+971509876001', '', 'Standard', ''],
];

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const format = (sp.get('format') || 'csv').toLowerCase();

    const allRows = [SAMPLE_HEADERS, ...SAMPLE_ROWS];

    if (format === 'csv' || format === 'tsv') {
      const sep = format === 'tsv' ? '\t' : ',';
      const csv = allRows
        .map((row) =>
          row
            .map((cell) => {
              const s = String(cell ?? '');
              // Quote cells that contain the separator, a quote, or a newline
              if (s.includes(sep) || s.includes('"') || s.includes('\n')) {
                return '"' + s.replace(/"/g, '""') + '"';
              }
              return s;
            })
            .join(sep),
        )
        .join('\r\n');

      const mime = format === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': `${mime}; charset=utf-8`,
          'Content-Disposition': `attachment; filename="employees-sample.${format}"`,
        },
      });
    }

    if (format === 'json') {
      const objects = SAMPLE_ROWS.map((row) => {
        const obj: Record<string, string | number> = {};
        SAMPLE_HEADERS.forEach((h, i) => {
          obj[h] = row[i] ?? '';
        });
        return obj;
      });
      const json = JSON.stringify({ employees: objects }, null, 2);
      return new NextResponse(json, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="employees-sample.json"',
        },
      });
    }

    if (format === 'xlsx') {
      const ws = XLSX.utils.aoa_to_sheet(allRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Employees');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="employees-sample.xlsx"',
        },
      });
    }

    return NextResponse.json(
      { success: false, error: `Unsupported format: ${format}. Use csv, tsv, xlsx, or json.` },
      { status: 400 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
