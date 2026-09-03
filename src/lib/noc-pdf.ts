/**
 * noc-pdf.ts — generates No Objection Certificate PDFs that replicate the
 * company's reference NOC letters exactly (letterhead, To/Date block,
 * Subject/Project, standard body paragraph, bordered employee table,
 * signature block with stamp, footer motto on every page).
 *
 * A4 portrait (595.28 x 841.89 pt), Times-Roman family (same as reference).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

export interface NocEmployeeRow {
  name: string;
  trade: string;
  company: string;
  nationality: string;
  passport: string;
}

export interface NocData {
  clientName: string;
  projectName: string;
  clientAddress: string;
  nocDate: string; // DD-MM-YYYY as printed
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  stampType: string; // "procurement" | "signature" | "none"
  employees: NocEmployeeRow[];
  /** Admin-configurable legal wording; {{company}} is rendered bold. */
  bodyText?: string;
  companyName?: string;
}

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 44;
const TABLE_W = A4_W - MARGIN * 2; // 507.28 — matches reference table span

// Column ratios tuned so the NOC wraps exactly like the reference (Sn | Name | Trade | Company | Nationality | Passport)
const COL_RATIOS = [0.083, 0.222, 0.112, 0.3097, 0.1404, 0.1329];
const COL_W = COL_RATIOS.map((r) => TABLE_W * r);

const BLACK = rgb(0, 0, 0);
const BLUE = rgb(0, 0, 0.72);
const CELL_FONT_SIZE = 8;
const CELL_LINE_H = 11.4;
const CELL_PAD_X = 2.5;
const ROW_MIN_H = 14.4;
const ROW_PAD_TOTAL = 3; // total vertical padding inside a row
const TABLE_HEADER_H = 18;
const LETTERHEAD_H = 119; // letterhead snapshot occupies exactly this band on page 1

// Vertical budget for placing the signature block on the current page
const FOOTER_TOP = 58; // footer rule sits at y=48; keep content above 58
const SIGNATURE_BLOCK_H = 168;

function assetPath(name: string): string {
  return path.join(process.cwd(), 'src', 'assets', 'noc', name);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = (text ?? '').toString().trim();
  if (!clean) return [''];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // single very long word — hard-split it
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  yTop: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
  color = BLACK,
  align: 'left' | 'center' = 'left',
): number {
  const lines = wrapText(text, font, size, maxWidth);
  let y = yTop;
  for (const line of lines) {
    const w = font.widthOfTextAtSize(line, size);
    const x0 = align === 'center' ? x + (maxWidth - w) / 2 : x;
    page.drawText(line, { x: x0, y: y - size, size, font, color });
    y -= lineHeight;
  }
  return y; // y of the next line's top
}

function drawFooter(page: PDFPage, fontBold: PDFFont) {
  const motto = 'Combination of Skills, Strength, Life & Ethics';
  page.drawLine({
    start: { x: MARGIN, y: 48 },
    end: { x: A4_W - MARGIN, y: 48 },
    thickness: 0.8,
    color: BLACK,
  });
  const size = 9.5;
  const w = fontBold.widthOfTextAtSize(motto, size);
  page.drawText(motto, {
    x: (A4_W - w) / 2,
    y: 34,
    size,
    font: fontBold,
    color: BLACK,
  });
}

function drawLetterhead(page: PDFPage, letterhead: PDFImage) {
  // Full-width letterhead snapshot (300 DPI crop of the reference page 1 top
  // band) — drawn at its exact reference size for a pixel-identical match.
  page.drawImage(letterhead, {
    x: 0,
    y: A4_H - LETTERHEAD_H,
    width: A4_W,
    height: LETTERHEAD_H,
  });
}

export async function generateNocPdf(data: NocData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`NOC ${data.clientName} ${data.projectName} ${data.nocDate}`.trim());
  pdf.setAuthor('Arabian Shield A/C. Units Fix. Cont');

  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const letterhead = await pdf.embedPng(fs.readFileSync(assetPath('letterhead.png')));
  const stampImg =
    data.stampType === 'signature'
      ? await pdf.embedPng(fs.readFileSync(assetPath('stamp-signature.png')))
      : data.stampType === 'none'
        ? null
        : await pdf.embedPng(fs.readFileSync(assetPath('stamp-procurement.png')));

  // y where page-1 content starts, right under the letterhead block
  const page1ContentTop = A4_H - LETTERHEAD_H - 22;

  let page: PDFPage = pdf.addPage([A4_W, A4_H]);
  drawLetterhead(page, letterhead);
  let contentTop = page1ContentTop;

  // ── To: / Date: ──
  let y = contentTop;
  page.drawText('To:', { x: MARGIN, y: y - 12, size: 12.5, font: fontBold, color: BLACK });
  const dateLabel = `Date: ${data.nocDate}`;
  const dateW = fontBold.widthOfTextAtSize(dateLabel, 12.5);
  page.drawText(dateLabel, { x: A4_W - MARGIN - dateW, y: y - 12, size: 12.5, font: fontBold, color: BLACK });
  y -= 21;

  // ── Client block (name + address lines) ──
  page.drawText(data.clientName, { x: MARGIN + 6, y: y - 12, size: 12.5, font: fontBold, color: BLACK });
  y -= 17;
  const addressLines = (data.clientAddress || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of addressLines) {
    page.drawText(line, { x: MARGIN + 6, y: y - 12, size: 12.5, font: fontBold, color: BLACK });
    y -= 17;
  }
  y -= 8;

  // ── Subject / Project ──
  page.drawText('Subject:', { x: MARGIN, y: y - 12, size: 12.5, font: fontBold, color: BLACK });
  page.drawText('NO OBJECTION CERTIFICATE', { x: MARGIN + 108, y: y - 12, size: 12.5, font: fontBold, color: BLACK });
  y -= 15;
  page.drawText('Project:', { x: MARGIN, y: y - 12, size: 12.5, font: fontBold, color: BLACK });
  if (data.projectName) {
    page.drawText(data.projectName, { x: MARGIN + 108, y: y - 12, size: 12.5, font: fontBold, color: BLACK });
  }
  y -= 15;

  // ── Body paragraph (template-driven; {{company}} renders bold) ──
  y -= 12;
  const bodyWidth = TABLE_W;
  const bodyLineH = 13.4;
  const bodySize = 12.3;
  const companyName = (data.companyName || 'ARABIAN SHIELD A/C. UNITS FIX. CONT').toUpperCase();
  const rawBody =
    data.bodyText && data.bodyText.trim()
      ? data.bodyText
      : 'We would like the following workers of our organization to work with your company. Our company takes full responsibility for our workers as regards to their salary, welfare and any other requirements. In case of any injury or untoward incident at site we M/s {{company}}., take all Liabilities & Claims and take full responsibility for our workers.';
  // Token stream: word + bold flag, then greedy wrap across the flow.
  const bodyTexts: Array<{ t: string; b: boolean }> = rawBody
    .split('{{company}}')
    .flatMap((segment, i, arr) => {
      const parts: Array<{ t: string; b: boolean }> = [{ t: segment, b: false }];
      if (i < arr.length - 1) parts.push({ t: companyName, b: true });
      return parts;
    });
  const tokens: Array<{ w: string; b: boolean }> = [];
  for (const part of bodyTexts) {
    for (const w of part.t.split(' ').filter(Boolean)) tokens.push({ w, b: part.b });
  }
  let lineX = MARGIN;
  for (const tok of tokens) {
    const tokFont = tok.b ? fontBold : font;
    const wordW = tokFont.widthOfTextAtSize(tok.w, bodySize);
    const spaceW = tokFont.widthOfTextAtSize(' ', bodySize);
    const needed = (lineX > MARGIN ? spaceW : 0) + wordW;
    if (lineX + needed > MARGIN + bodyWidth && lineX > MARGIN) {
      y -= bodyLineH;
      lineX = MARGIN;
    }
    const drawX = lineX > MARGIN ? lineX + spaceW : lineX;
    page.drawText(tok.w, { x: drawX, y: y - bodySize, size: bodySize, font: tokFont, color: BLACK });
    lineX = drawX + wordW;
  }
  y -= bodyLineH + 12;

  // ── Employee table ──
  const drawTableHeader = (page: PDFPage, yTop: number): number => {
    const headerLabels = ['Sn.No', 'Name', 'Trade', 'Company', 'Nationality', 'Passport #'];
    const h = TABLE_HEADER_H;
    let x = MARGIN;
    for (let c = 0; c < 6; c++) {
      page.drawRectangle({ x, y: yTop - h, width: COL_W[c], height: h, borderColor: BLACK, borderWidth: 0.9 });
      const label = headerLabels[c];
      const lw = fontBold.widthOfTextAtSize(label, 9);
      // Reference: Sn.No centred, all other headers left-aligned
      const lx = c === 0 ? x + (COL_W[c] - lw) / 2 : x + 5;
      page.drawText(label, { x: lx, y: yTop - h / 2 - 3, size: 9, font: fontBold, color: BLACK });
      x += COL_W[c];
    }
    return yTop - h;
  };

  const rowHeightFor = (row: NocEmployeeRow): number => {
    const cells = [String(row.name || ''), String(row.trade || ''), String(row.company || ''), String(row.nationality || ''), String(row.passport || '')];
    let maxLines = 1;
    for (let c = 0; c < cells.length; c++) {
      const lines = wrapText(cells[c], font, CELL_FONT_SIZE, COL_W[c + 1] - CELL_PAD_X * 2).length;
      maxLines = Math.max(maxLines, lines);
    }
    return Math.max(ROW_MIN_H, maxLines * CELL_LINE_H + ROW_PAD_TOTAL);
  };

  // helper: ensure space for a row of h pt; page-break if needed.
  // The table header REPEATS on every continuation page (PRD §21/§70).
  const ensureSpace = (needed: number): void => {
    if (y - needed < FOOTER_TOP + 6) {
      drawFooter(page, fontBold);
      page = pdf.addPage([A4_W, A4_H]);
      y = A4_H - 40;
      y = drawTableHeader(page, y);
    }
  };

  // Header row (drawn once on the first page of the table, like the reference)
  ensureSpace(26);
  y = drawTableHeader(page, y);

  data.employees.forEach((row, idx) => {
    const rh = rowHeightFor(row);
    ensureSpace(rh);
    let x = MARGIN;
    // borders first
    for (let c = 0; c < 6; c++) {
      page.drawRectangle({ x, y: y - rh, width: COL_W[c], height: rh, borderColor: BLACK, borderWidth: 0.9 });
      x += COL_W[c];
    }
    // Sn number centered
    const snText = String(idx + 1);
    const snW = font.widthOfTextAtSize(snText, CELL_FONT_SIZE + 0.5);
    page.drawText(snText, {
      x: MARGIN + (COL_W[0] - snW) / 2,
      y: y - rh / 2 - 2.8,
      size: CELL_FONT_SIZE + 0.5,
      font,
      color: BLACK,
    });
    // remaining columns, wrapped, vertically centred
    const cells = [row.name, row.trade, row.company, row.nationality, row.passport].map((v) => String(v || ''));
    let cx = MARGIN + COL_W[0];
    for (let c = 0; c < cells.length; c++) {
      const availW = COL_W[c + 1] - CELL_PAD_X * 2;
      const lines = wrapText(cells[c], font, CELL_FONT_SIZE, availW);
      const blockH = lines.length * CELL_LINE_H;
      let ty = y - rh / 2 + blockH / 2;
      for (const line of lines) {
        page.drawText(line, { x: cx + CELL_PAD_X, y: ty - CELL_FONT_SIZE, size: CELL_FONT_SIZE, font, color: BLACK });
        ty -= CELL_LINE_H;
      }
      cx += COL_W[c + 1];
    }
    y -= rh;
  });

  // ── Signature block ──
  const sigTopNeeded = SIGNATURE_BLOCK_H;
  if (y - sigTopNeeded < FOOTER_TOP + 6) {
    drawFooter(page, fontBold);
    page = pdf.addPage([A4_W, A4_H]);
    y = A4_H - 60;
  } else {
    y -= 34; // gap before signature when on the same page
  }

  page.drawText('Thanks & Regards', { x: MARGIN, y: y - 12.5, size: 12.5, font: fontBold, color: BLACK });
  y -= 32;
  page.drawText('ARABIAN SHIELD A/C. UNITS FIX. CONT', { x: MARGIN, y: y - 13, size: 13, font: fontBold, color: BLACK });

  // stamp on the right at its exact reference size
  if (stampImg) {
    const stW = data.stampType === 'signature' ? 150 : 152;
    const stH = (stW * stampImg.height) / stampImg.width;
    page.drawImage(stampImg, {
      x: A4_W - MARGIN - stW - 6,
      y: y - stH + 10,
      width: stW,
      height: stH,
    });
  }

  y -= 30;
  page.drawText(data.contactPerson, { x: MARGIN, y: y - 12.5, size: 12.5, font: fontBold, color: BLACK });
  y -= 28;
  page.drawText(data.contactPhone, { x: MARGIN, y: y - 12.5, size: 12.5, font: fontBold, color: BLACK });
  y -= 28;
  const email = data.contactEmail;
  page.drawText(email, { x: MARGIN, y: y - 12.5, size: 12.5, font: fontBold, color: BLUE });
  page.drawLine({
    start: { x: MARGIN, y: y - 15 },
    end: { x: MARGIN + fontBold.widthOfTextAtSize(email, 12.5), y: y - 15 },
    thickness: 0.8,
    color: BLUE,
  });

  drawFooter(page, fontBold);

  return pdf.save();
}

/** Sanitized storage file name for a NOC, mirroring the reference naming. */
export function buildNocFileName(data: { clientName: string; projectName: string; nocDate: string }): string {
  const clean = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  // Reference files drop the "M/S" / "M/s." prefix.
  // Standard: "NOC - CLIENT - PROJECT - DD-MM-YYYY.pdf"
  const clientForFile = clean(data.clientName).replace(/^M\s*\/?\s*S\.?\s+/i, '');
  const parts = ['NOC', clientForFile, clean(data.projectName), data.nocDate].filter(Boolean);
  return parts.join(' - ').replace(/\.+$/, '') + '.pdf';
}

/** YYYY-MM month key from a DD-MM-YYYY date string (falls back to today). */
export function monthKeyFromNocDate(nocDate: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(nocDate.trim());
  if (m) return `${m[3]}-${m[2]}`;
  const iso = /^(\d{4})-(\d{2})/.exec(nocDate.trim());
  if (iso) return `${iso[1]}-${iso[2]}`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
