import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

// ---------------------------------------------------------------------------
// Column header → employee field mapping (case-insensitive fuzzy match)
// ---------------------------------------------------------------------------
const HEADER_MAP: Record<string, string[]> = {
  fullName: ['full name', 'name', 'employee name', 'fullname', 'employee_name', 'employeename'],
  nationality: ['nationality', 'country', 'nation'],
  dateOfBirth: ['date of birth', 'dob', 'birth date', 'date_of_birth', 'birthdate', 'birthday'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'mobile number', 'contact number', 'telephone'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  address: ['address', 'location', 'residence'],
  emergencyContact: ['emergency contact', 'emergency_contact', 'emergency number', 'emergency phone'],
  trade: ['trade', 'position', 'role', 'designation', 'job title', 'jobtitle', 'job_title', 'profession'],
  joinDate: ['join date', 'joining date', 'start date', 'join_date', 'joining_date', 'start_date', 'date of joining'],
  companyName: ['company', 'company name', 'organization', 'company_name', 'org', 'organisation'],
  passportNumber: ['passport number', 'passport no', 'passport_no', 'passport', 'passportnumber'],
  passportStatus: ['passport status', 'passport_status', 'passport status'],
  idNumber: ['id number', 'id no', 'identity number', 'id_number', 'id_no', 'identity_number', 'identity no', 'national id', 'nationalid'],
  idStatus: ['id status', 'id_status'],
  currentSite: ['site', 'current site', 'work site', 'current_site', 'work_site', 'project site', 'project'],
  employeeId: ['employee id', 'employee_id', 'custom id', 'custom_id', 'emp id', 'emp_id', 'emp code', 'empcode', 'employee code', 'employee_code', 'id'],
  role: ['role', 'employee role', 'employee_role', 'employee type', 'employee_type'],
  customHourlyRate: ['custom rate', 'custom_rate', 'hourly rate', 'hourly_rate', 'custom hourly rate', 'custom_hourly_rate', 'rate'],
};

const ALLOWED_EXTENSIONS = ['.txt', '.csv', '.tsv', '.xlsx', '.xls', '.pdf', '.docx', '.doc', '.json'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate auto employeeId: ASM-YYYY-NNN */
async function generateEmployeeId(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ASM-${year}-`;

  const employees = await db.employee.findMany({
    where: { employeeId: { startsWith: prefix } },
    select: { employeeId: true },
    orderBy: { employeeId: 'desc' },
  });

  let nextNum = 1;
  if (employees.length > 0) {
    const lastNum = parseInt(employees[0].employeeId.split('-')[2], 10);
    nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

/** Normalise a header string for comparison */
function normalise(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[_\-\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map an array of raw header strings to their employee field names */
function mapHeaders(rawHeaders: string[]): Map<number, string> {
  const mapping = new Map<number, string>();

  for (let i = 0; i < rawHeaders.length; i++) {
    const norm = normalise(rawHeaders[i]);
    let matched = false;

    for (const [field, aliases] of Object.entries(HEADER_MAP)) {
      if (aliases.includes(norm)) {
        mapping.set(i, field);
        matched = true;
        break;
      }
    }

    // If no alias matched, skip the column (unmapped)
    if (!matched) {
      // Also try direct field name match
      for (const field of Object.keys(HEADER_MAP)) {
        if (norm === field.toLowerCase()) {
          mapping.set(i, field);
          break;
        }
      }
    }
  }

  return mapping;
}

/** Convert a raw cell value to a Date or null */
function parseDate(value: string | number | undefined | null): Date | null {
  if (value === undefined || value === null || value === '') return null;

  // Excel serial date number
  if (typeof value === 'number') {
    // XLSX library already converts serial dates when using sheet_to_json with raw:false
    // but if we get a number, treat it as an Excel serial date
    if (value > 25569 && value < 100000) {
      // Likely an Excel serial date – convert
      const date = XLSX.SSF.parse_date_code(value);
      if (date) {
        return new Date(date.y, date.m - 1, date.d);
      }
    }
    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  // Try ISO format first
  const iso = Date.parse(str);
  if (!isNaN(iso)) return new Date(iso);

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    return new Date(year, parseInt(m, 10) - 1, parseInt(d, 10));
  }

  return null;
}

/** Parse a string value, trimming whitespace */
function parseString(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str || null;
}

// ---------------------------------------------------------------------------
// File Parsers
// ---------------------------------------------------------------------------

/** Parse CSV / TSV / TXT – comma or tab separated.
 *  If `separator` is omitted, the function sniffs the first line to decide
 *  between tab and comma. Pass an explicit separator to override the sniff. */
function parseCsvTxt(content: string, separator?: string): Record<string, string | number | null>[] {
  // Detect separator if not provided: tab vs comma
  if (!separator) {
    const firstLine = content.split(/\r?\n/)[0] || '';
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    separator = tabCount > commaCount ? '\t' : ',';
  }

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(separator).map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string | number | null>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(separator).map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string | number | null> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || null;
    }
    rows.push(row);
  }

  return rows;
}

/** Parse JSON – accepts either an array of objects or an object with an
 *  `employees` (or `data`) array property. */
function parseJson(content: string): Record<string, string | number | null>[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  let arr: unknown[] = [];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.employees)) arr = obj.employees;
    else if (Array.isArray(obj.data)) arr = obj.data;
    else arr = [obj]; // single object
  }

  return arr.map((item) => {
    if (item && typeof item === 'object') {
      // Coerce all values to string|number|null
      const out: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (v === null || v === undefined) out[k] = null;
        else if (typeof v === 'number') out[k] = v;
        else if (typeof v === 'string') out[k] = v;
        else out[k] = String(v);
      }
      return out;
    }
    return {};
  });
}

/** Parse Excel (.xlsx / .xls) */
function parseExcel(buffer: Buffer): Record<string, string | number | null>[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  // sheet_to_json with defval ensures empty cells are included as empty strings
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(sheet, {
    defval: '',
    raw: false, // Get formatted strings so dates are human-readable
  });
  return rows;
}

/** Parse PDF – extract text and attempt tabular data extraction */
async function parsePdf(buffer: Buffer): Promise<Record<string, string | number | null>[]> {
  // Dynamic import to avoid pdf-parse's test file loading issue at module level
  const pdf = (await import('pdf-parse')).default;
  const data = await pdf(buffer);
  const text = data.text;

  // Try to detect tabular data: lines with consistent separators
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Detect separator pattern – try multiple common separators
  const separators = [/\s{2,}/, /\t/, /\|/];

  for (const sep of separators) {
    const splitLines = lines.map((l) => l.split(sep).map((c) => c.trim()).filter(Boolean));
    // Check if at least the first two lines have the same number of columns
    if (splitLines.length >= 2 && splitLines[0].length >= 2) {
      const colCount = splitLines[0].length;
      const consistentRows = splitLines.filter((r) => r.length === colCount || r.length === colCount - 1);

      if (consistentRows.length >= 2) {
        const headers = splitLines[0];
        const rows: Record<string, string | number | null>[] = [];

        for (let i = 1; i < splitLines.length; i++) {
          const values = splitLines[i];
          if (values.length < 2) continue; // skip non-data lines

          const row: Record<string, string | number | null> = {};
          for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j] || null;
          }
          rows.push(row);
        }

        if (rows.length > 0) return rows;
      }
    }
  }

  // Fallback: try comma-separated parsing on the extracted text
  return parseCsvTxt(text);
}

/** Parse Word (.docx / .doc) using mammoth */
async function parseDocx(buffer: Buffer): Promise<Record<string, string | number | null>[]> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  // Try tabular detection similar to PDF
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Try tab separator first (common in Word tables)
  const tabSplitLines = lines.map((l) => l.split(/\t/).map((c) => c.trim()).filter(Boolean));
  if (tabSplitLines.length >= 2 && tabSplitLines[0].length >= 2) {
    const colCount = tabSplitLines[0].length;
    const consistentRows = tabSplitLines.filter((r) => r.length >= colCount - 1);
    if (consistentRows.length >= 2) {
      const headers = tabSplitLines[0];
      const rows: Record<string, string | number | null>[] = [];
      for (let i = 1; i < tabSplitLines.length; i++) {
        const values = tabSplitLines[i];
        if (values.length < 2) continue;
        const row: Record<string, string | number | null> = {};
        for (let j = 0; j < headers.length; j++) {
          row[headers[j]] = values[j] || null;
        }
        rows.push(row);
      }
      if (rows.length > 0) return rows;
    }
  }

  // Fallback: try comma-separated or multi-space separated
  return parseCsvTxt(text);
}

// ---------------------------------------------------------------------------
// Main POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    // Optional explicit format hint from the client. When provided, this
    // overrides extension-based detection so the user can tell us, e.g.,
    // "this .txt file is actually a CSV" or "this .csv file uses tabs".
    // Accepted values: 'csv', 'tsv', 'xlsx', 'pdf', 'docx', 'json'
    const formatHint = (formData.get('format') as string | null)?.toLowerCase().trim() || null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 },
      );
    }

    // Validate extension
    const fileName = file.name.toLowerCase();
    const ext = '.' + fileName.split('.').pop();
    const allowedExtensions = ALLOWED_EXTENSIONS.concat(['.json']);
    if (!allowedExtensions.includes(ext)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file type "${ext}". Allowed: ${allowedExtensions.join(', ')}`,
        },
        { status: 400 },
      );
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine the parser to use. Priority:
    //   1. Explicit format hint from client
    //   2. File extension
    let parserKind: 'csv' | 'tsv' | 'xlsx' | 'pdf' | 'docx' | 'json';

    if (formatHint === 'csv' || formatHint === 'tsv' || formatHint === 'xlsx' || formatHint === 'pdf' || formatHint === 'docx' || formatHint === 'json') {
      parserKind = formatHint;
    } else if (ext === '.csv') {
      parserKind = 'csv';
    } else if (ext === '.txt') {
      // .txt is ambiguous — sniff the first line for tab vs comma
      const firstLine = buffer.toString('utf-8').split(/\r?\n/)[0] || '';
      parserKind = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? 'tsv' : 'csv';
    } else if (ext === '.xlsx' || ext === '.xls') {
      parserKind = 'xlsx';
    } else if (ext === '.pdf') {
      parserKind = 'pdf';
    } else if (ext === '.docx' || ext === '.doc') {
      parserKind = 'docx';
    } else if (ext === '.json') {
      parserKind = 'json';
    } else {
      return NextResponse.json(
        { success: false, error: `Cannot determine parser for file type "${ext}"` },
        { status: 400 },
      );
    }

    // Parse based on chosen parser
    let rawRows: Record<string, string | number | null>[] = [];

    try {
      if (parserKind === 'csv') {
        const content = buffer.toString('utf-8');
        rawRows = parseCsvTxt(content, ',');
      } else if (parserKind === 'tsv') {
        const content = buffer.toString('utf-8');
        rawRows = parseCsvTxt(content, '\t');
      } else if (parserKind === 'xlsx') {
        rawRows = parseExcel(buffer);
      } else if (parserKind === 'pdf') {
        rawRows = await parsePdf(buffer);
      } else if (parserKind === 'docx') {
        rawRows = await parseDocx(buffer);
      } else if (parserKind === 'json') {
        const content = buffer.toString('utf-8');
        rawRows = parseJson(content);
      }
    } catch (parseError: unknown) {
      const message = parseError instanceof Error ? parseError.message : 'Failed to parse file';
      return NextResponse.json(
        { success: false, error: `File parsing error: ${message}` },
        { status: 400 },
      );
    }

    if (rawRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No data rows found in the file. Ensure the file has a header row and at least one data row.' },
        { status: 400 },
      );
    }

    // Map headers
    const rawHeaders = Object.keys(rawRows[0]);
    const headerMapping = mapHeaders(rawHeaders);

    if (headerMapping.size === 0) {
      return NextResponse.json(
        { success: false, error: 'No recognized column headers found. Please ensure headers like "Full Name", "Nationality", etc. are present.' },
        { status: 400 },
      );
    }

    // Check if fullName column exists
    const hasFullNameColumn = [...headerMapping.values()].includes('fullName');
    if (!hasFullNameColumn) {
      return NextResponse.json(
        { success: false, error: 'Required column "Full Name" (or "Name") not found in the file.' },
        { status: 400 },
      );
    }

    // Process rows
    const total = rawRows.length;
    let created = 0;
    const errors: { row: number; message: string }[] = [];

    for (let rowIdx = 0; rowIdx < rawRows.length; rowIdx++) {
      const rawRow = rawRows[rowIdx];
      const rowNumber = rowIdx + 2; // 1-based + header row

      try {
        // Build mapped data
        const mappedData: Record<string, string | number | null> = {};
        for (const [colIdx, field] of headerMapping.entries()) {
          const headerKey = rawHeaders[colIdx];
          mappedData[field] = rawRow[headerKey] ?? null;
        }

        // fullName is required
        const fullName = parseString(mappedData.fullName);
        if (!fullName) {
          errors.push({ row: rowNumber, message: 'Full name is required' });
          continue;
        }

        // Handle custom ID from file: if employee_id/custom_id is provided, use it;
        // otherwise auto-generate
        const customIdRaw = parseString(mappedData.employeeId);
        let employeeId: string;

        if (customIdRaw) {
          // Strip spaces from custom ID
          employeeId = customIdRaw.replace(/\s+/g, '');

          // Validate: check if this custom ID already exists in the system
          const existingWithId = await db.employee.findUnique({ where: { employeeId } });
          if (existingWithId) {
            errors.push({ row: rowNumber, message: `Custom employee ID "${employeeId}" already exists in the system (employee: ${existingWithId.fullName})` });
            continue;
          }
        } else {
          // Auto-generate employeeId
          employeeId = await generateEmployeeId();

          // Safety net check for generated ID
          const existing = await db.employee.findUnique({ where: { employeeId } });
          if (existing) {
            errors.push({ row: rowNumber, message: `Generated employee ID ${employeeId} already exists` });
            continue;
          }
        }

        // Parse role from file, derive from trade if not provided
        const roleRaw = parseString(mappedData.role);
        let isTeamLeader = false;
        let isSupervisor = false;
        let role = 'Standard';

        if (roleRaw) {
          const roleLower = roleRaw.toLowerCase().trim();
          if (roleLower.includes('supervisor') || roleLower.includes('sup')) {
            isSupervisor = true;
            role = 'Supervisor';
          } else if (roleLower.includes('team leader') || roleLower.includes('team leader') || roleLower.includes('tl') || roleLower.includes('leader')) {
            isTeamLeader = true;
            role = 'Team Leader';
          } else {
            role = roleRaw;
          }
        }

        // Parse custom hourly rate
        const customHourlyRateRaw = parseString(mappedData.customHourlyRate);
        const customHourlyRate = customHourlyRateRaw ? parseFloat(customHourlyRateRaw) : null;
        if (customHourlyRateRaw && (isNaN(customHourlyRate!) || customHourlyRate! < 0)) {
          errors.push({ row: rowNumber, message: `Invalid custom hourly rate: "${customHourlyRateRaw}"` });
          continue;
        }

        // Build create data
        const data: Record<string, unknown> = {
          fullName,
          employeeId,
          nationality: parseString(mappedData.nationality),
          dateOfBirth: parseDate(mappedData.dateOfBirth),
          phone: parseString(mappedData.phone),
          email: parseString(mappedData.email),
          address: parseString(mappedData.address),
          emergencyContact: parseString(mappedData.emergencyContact),
          position: parseString(mappedData.trade), // Sync trade → position for backward compat
          trade: parseString(mappedData.trade),
          joinDate: parseDate(mappedData.joinDate),
          companyName: parseString(mappedData.companyName),
          passportStatus: parseString(mappedData.passportStatus),
          idStatus: parseString(mappedData.idStatus),
          currentSite: parseString(mappedData.currentSite),
          rating: 5,
          status: 'active',
          isTeamLeader,
          isSupervisor,
          role,
          customHourlyRate,
        };

        // Encrypt sensitive fields
        const passportNumber = parseString(mappedData.passportNumber);
        if (passportNumber) {
          data.passportNumber = encrypt(passportNumber);
        }

        const idNumber = parseString(mappedData.idNumber);
        if (idNumber) {
          data.idNumber = encrypt(idNumber);
        }

        await db.employee.create({
          data: data as Parameters<typeof db.employee.create>[0]['data'],
        });

        created++;
      } catch (rowError: unknown) {
        const message = rowError instanceof Error ? rowError.message : 'Unknown error';
        errors.push({ row: rowNumber, message });
      }
    }

    const failed = total - created;

    return NextResponse.json({
      success: true,
      data: {
        total,
        created,
        failed,
        errors,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
