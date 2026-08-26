import type { Report } from './types.js';
import { GROUPS, ALL_FIELDS, NUMERIC_KEYS, MONTHS } from './constants.js';
import { state } from './state.js';
import { pad, parseISO, monthKeyOf, weekday } from './dateUtils.js';
import { num, numOrNull } from './format.js';
import { metaFor, metaDiaVal, aprovadasNoMes, monthTotals, weeklyBreakdown } from './aggregations.js';
import { toast } from './ui.js';

/* ---------------- PDF generation (no external library) ---------------- */
// Colors (0-1) used in the PDF
type RGB01 = [number, number, number];
const PDF = {
  RED: [0.91, 0.45, 0.31] as RGB01, WHITE: [1, 1, 1] as RGB01, INK: [0.11, 0.11, 0.14] as RGB01,
  MUTED: [0.42, 0.45, 0.50] as RGB01, LIGHT: [0.88, 0.89, 0.91] as RGB01, GREEN: [0.12, 0.62, 0.34] as RGB01,
};
function pdfEsc(s: any): string { return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function latin1(s: any): string { return String(s).replace(/[^\x00-\xFF]/g, ''); } // strip anything that isn't Latin-1 (e.g. emoji)

// Accent color per field (mirrors the meaning already used elsewhere: green/red/amber for
// the proposal outcomes). Anything not listed falls back to the brand red.
const FIELD_COLOR: Record<string, RGB01> = {
  aprovadas: [0.047, 0.639, 0.047],
  reprovadas: [0.816, 0.231, 0.231],
  analise: [0.788, 0.522, 0.000],
  link: [0.117, 0.443, 0.831],
  cartaoAtivacao: [0.722, 0.525, 0.043],
  sms: [0.290, 0.333, 0.412],
  bonus: [0.831, 0.400, 0.055],
  odontoEfetivado: [0.043, 0.588, 0.502],
  odontoOfertado: [0.702, 0.169, 0.169],
};
const CARD_BG: RGB01 = [1, 1, 1];
const PAGE_BG: RGB01 = [0.957, 0.961, 0.969];

function buildReportPDF(r: Report): Blob {
  const d = parseISO(r.data);
  const mk = monthKeyOf(r.data);
  const meta = metaFor(mk);
  const feitas = aprovadasNoMes(mk);
  const pct = meta > 0 ? Math.round((feitas / meta) * 100) : 0;

  let c = '';
  const F1 = 'F1', F2 = 'F2';
  const txt = (x: number, y: number, size: number, font: string, color: RGB01, s: any) => {
    const [rr, gg, bb] = color;
    c += `BT /${font} ${size} Tf ${rr} ${gg} ${bb} rg ${x} ${y} Td (${pdfEsc(latin1(s))}) Tj ET\n`;
  };
  const rect = (x: number, y: number, w: number, h: number, color: RGB01) => { const [rr, gg, bb] = color; c += `${rr} ${gg} ${bb} rg ${x} ${y} ${w} ${h} re f\n`; };
  const line = (x1: number, y: number, x2: number, color: RGB01) => { const [rr, gg, bb] = color; c += `${rr} ${gg} ${bb} RG 0.6 w ${x1} ${y} m ${x2} ${y} l S\n`; };
  // Rounded card background — 4 straight edges + 4 Bézier corner arcs (k ≈ 0.5523 * r).
  const roundedRect = (x: number, y: number, w: number, h: number, r: number, color: RGB01) => {
    const [rr, gg, bb] = color, k = 0.5523 * r;
    c += `${rr} ${gg} ${bb} rg `
      + `${x + r} ${y} m ${x + w - r} ${y} l `
      + `${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} c ${x + w} ${y + h - r} l `
      + `${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} c ${x + r} ${y + h} l `
      + `${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} c ${x} ${y + r} l `
      + `${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} c f\n`;
  };
  // Filled dot — 4 Bézier quarter-arcs around the center (same k constant as roundedRect).
  const dot = (cx: number, cy: number, R: number, color: RGB01) => {
    const [rr, gg, bb] = color, k = 0.5523 * R;
    c += `${rr} ${gg} ${bb} rg `
      + `${cx + R} ${cy} m ${cx + R} ${cy + k} ${cx + k} ${cy + R} ${cx} ${cy + R} c `
      + `${cx - k} ${cy + R} ${cx - R} ${cy + k} ${cx - R} ${cy} c `
      + `${cx - R} ${cy - k} ${cx - k} ${cy - R} ${cx} ${cy - R} c `
      + `${cx + k} ${cy - R} ${cx + R} ${cy - k} ${cx + R} ${cy} c f\n`;
  };

  // Page background (the white cards need something other than white to stand out against).
  rect(0, 0, 595, 792, PAGE_BG);
  // Red header band
  rect(0, 792, 595, 50, PDF.RED);
  txt(40, 814, 19, F2, PDF.WHITE, 'RELATÓRIO DIÁRIO');
  txt(40, 799, 10.5, F1, PDF.WHITE, (r.loja || 'Savegnago') + '   ·   ' + (r.promotora || ''));

  let y = 752;
  // Date
  const dataFmt = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  txt(40, y, 10, F1, PDF.MUTED, 'DATA');
  txt(40, y - 17, 15, F2, PDF.INK, dataFmt + '   ·   ' + weekday(d));
  y -= 44;

  const sectionTitle = (title: string) => { txt(40, y, 10.5, F2, PDF.RED, title.toUpperCase()); y -= 18; };

  const COLS = 3, GAP = 8, CARD_W = (515 - GAP * (COLS - 1)) / COLS, CARD_H = 54;
  // Draws one row of up to COLS cards, advancing y past ALL rows needed for `fields`.
  const cardsGrid = (fields: { label: string; value: any; color: RGB01 }[]) => {
    for (let i = 0; i < fields.length; i += COLS) {
      const rowFields = fields.slice(i, i + COLS);
      rowFields.forEach((f, col) => {
        const x = 40 + col * (CARD_W + GAP);
        roundedRect(x, y - CARD_H, CARD_W, CARD_H, 8, CARD_BG);
        dot(x + 15, y - 14, 4, f.color);
        txt(x + 12, y - 34, 20, F2, PDF.INK, String(f.value));
        txt(x + 12, y - 47, 8.5, F1, PDF.MUTED, f.label.toUpperCase());
      });
      y -= CARD_H + GAP;
    }
  };

  // Sections come from GROUPS: any new field is picked up automatically. Not informed = 0
  // (a field left blank on a single day means "didn't happen today", not "unknown").
  GROUPS.forEach(g => {
    sectionTitle(g.title);
    cardsGrid(g.fields.map(f => ({ label: f.label, value: num(r[f.key]), color: FIELD_COLOR[f.key] || PDF.RED })));
    y -= 8;
  });

  // Goals — same card treatment, wider (2 cols) since the values are fraction-shaped.
  sectionTitle('Metas');
  const md = metaDiaVal();
  const metaCards = [
    { label: 'Meta do dia', value: num(r.aprovadas) + ' / ' + md + (num(r.aprovadas) >= md ? ' (bateu)' : ''), color: PDF.GREEN },
    { label: 'Meta do mês', value: feitas + ' / ' + (meta || 0) + (meta ? ' (' + pct + '%)' : ''), color: PDF.RED },
  ];
  const MCOLS = 2, MGAP = 8, MCARD_W = (515 - MGAP) / MCOLS, MCARD_H = 54;
  metaCards.forEach((f, col) => {
    const x = 40 + col * (MCARD_W + MGAP);
    roundedRect(x, y - MCARD_H, MCARD_W, MCARD_H, 8, CARD_BG);
    dot(x + 15, y - 14, 4, f.color);
    txt(x + 12, y - 34, 16, F2, PDF.INK, String(f.value));
    txt(x + 12, y - 47, 8.5, F1, PDF.MUTED, f.label.toUpperCase());
  });
  y -= MCARD_H + 16;

  // Notes (with simple line wrapping), on its own light card.
  if (r.obs && String(r.obs).trim()) {
    sectionTitle('Observações');
    const words = String(r.obs).replace(/\s+/g, ' ').trim().split(' ');
    const lines: string[] = [];
    let ln = '';
    words.forEach((w: string) => {
      if ((ln + ' ' + w).length > 85) { lines.push(ln); ln = ''; }
      ln = ln ? ln + ' ' + w : w;
    });
    if (ln) lines.push(ln);
    const boxH = lines.length * 16 + 16;
    roundedRect(40, y - boxH, 515, boxH, 8, CARD_BG);
    let ly = y - 20;
    lines.forEach(l => { txt(52, ly, 11, F1, PDF.INK, l); ly -= 16; });
    y -= boxH;
  }

  // Footer
  line(40, 30, 555, PDF.LIGHT);
  let quando = '';
  try { quando = new Date().toLocaleString('pt-BR'); } catch (e) {}
  txt(40, 18, 9, F1, PDF.MUTED, 'Gerado em ' + quando + '  ·  App Relatório Diário');

  return assemblePdf(c);
}

function assemblePdf(c: string): Blob {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + c.length + ' >>\nstream\n' + c + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach(off => { pdf += String(off).padStart(10, '0') + ' 00000 n \n'; });
  pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

export function sharePDF(r: Report | null) {
  if (!r || !r.data) { toast('Nenhum relatório para gerar PDF', 'err'); return; }
  NUMERIC_KEYS.forEach(k => (r as any)[k] = numOrNull((r as any)[k]));
  const blob = buildReportPDF(r);
  const primeiroNome = (r.promotora || 'Edna').split(' ')[0];
  const fname = 'Relatorio_' + r.data + '_' + primeiroNome + '.pdf';
  downloadOrShare(blob, fname, 'application/pdf');
}

// Assembles an A4 PDF from a drawing function — reused by both the report and the summary.
function pdfBuild(draw: (helpers: {
  txt: (x: number, y: number, size: number, font: string, color: RGB01, s: any) => void;
  rect: (x: number, y: number, w: number, h: number, color: RGB01) => void;
  line: (x1: number, y: number, x2: number, color: RGB01) => void;
  sector: (cx: number, cy: number, R: number, a0: number, a1: number, color: RGB01) => void;
  F1: string; F2: string;
}) => void): Blob {
  let c = '';
  const F1 = 'F1', F2 = 'F2';
  const txt = (x: number, y: number, size: number, font: string, color: RGB01, s: any) => { const [r, g, b] = color; c += `BT /${font} ${size} Tf ${r} ${g} ${b} rg ${x} ${y} Td (${pdfEsc(latin1(s))}) Tj ET\n`; };
  const rect = (x: number, y: number, w: number, h: number, color: RGB01) => { const [r, g, b] = color; c += `${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f\n`; };
  const line = (x1: number, y: number, x2: number, color: RGB01) => { const [r, g, b] = color; c += `${r} ${g} ${b} RG 0.6 w ${x1} ${y} m ${x2} ${y} l S\n`; };
  // Filled pie sector (a0/a1 in radians, CCW). Approximates the arc with Béziers.
  const sector = (cx: number, cy: number, R: number, a0: number, a1: number, color: RGB01) => {
    const [r, g, b] = color;
    let s = `${r} ${g} ${b} rg ${cx} ${cy} m ${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} l `;
    let start = a0;
    const dir = a1 >= a0 ? 1 : -1;
    while (Math.abs(a1 - start) > 1e-6) {
      const step = dir * Math.min(Math.PI / 2, Math.abs(a1 - start));
      const end = start + step;
      const k = (4 / 3) * Math.tan(step / 4);
      const p0x = cx + R * Math.cos(start), p0y = cy + R * Math.sin(start);
      const c1x = p0x - k * R * Math.sin(start), c1y = p0y + k * R * Math.cos(start);
      const p1x = cx + R * Math.cos(end), p1y = cy + R * Math.sin(end);
      const c2x = p1x + k * R * Math.sin(end), c2y = p1y - k * R * Math.cos(end);
      s += `${c1x} ${c1y} ${c2x} ${c2y} ${p1x} ${p1y} c `;
      start = end;
    }
    c += s + `${cx} ${cy} l f\n`;
  };
  draw({ txt, rect, line, sector, F1, F2 });
  return assemblePdf(c);
}

function buildMonthPDF(monthKey: string): Blob {
  const [y, m] = monthKey.split('-').map(Number);
  const t = monthTotals(monthKey);
  const meta = metaFor(monthKey);
  const pct = meta > 0 ? Math.round(((t.aprovadas || 0) / meta) * 100) : 0;
  const weeks = weeklyBreakdown(monthKey);
  const PIE = [
    { label: 'Aprovadas', value: t.aprovadas || 0, color: [0.047, 0.639, 0.047] as RGB01 },
    { label: 'Reprovadas', value: t.reprovadas || 0, color: [0.816, 0.231, 0.231] as RGB01 },
    { label: 'Em Análise', value: t.analise || 0, color: [0.788, 0.522, 0.000] as RGB01 },
  ];
  const pieTotal = PIE.reduce((s, x) => s + (x.value as number), 0);

  return pdfBuild(({ txt, rect, line, sector, F1, F2 }) => {
    let yy = 752;
    rect(0, 792, 595, 50, PDF.RED);
    txt(40, 814, 19, F2, PDF.WHITE, 'RESUMO DO MÊS');
    txt(40, 799, 10.5, F1, PDF.WHITE, (state.config.loja || '') + '  ·  ' + (state.config.promotora || ''));
    txt(40, yy, 10, F1, PDF.MUTED, 'MÊS');
    txt(40, yy - 17, 15, F2, PDF.INK, MONTHS[m - 1] + ' ' + y + '   ·   ' + t._dias + ' dia(s) com relatório');
    yy -= 46;
    const section = (title: string) => { txt(40, yy, 11, F2, PDF.RED, title.toUpperCase()); line(40, yy - 6, 555, PDF.LIGHT); yy -= 24; };
    const row = (label: string, value: any) => { txt(48, yy, 12, F1, PDF.INK, label); txt(360, yy, 13, F2, PDF.INK, String(value)); yy -= 21; };
    section('Meta');
    row('Aprovados no mês', (t.aprovadas || 0) + ' / ' + (meta || 0) + (meta ? '   (' + pct + '%)' : ''));
    yy -= 6;

    // Proposal pie chart + legend
    section('Propostas');
    const cx = 115, cy = yy - 62, R = 56;
    if (pieTotal <= 0) {
      sector(cx, cy, R, 0, 2 * Math.PI - 1e-4, [0.90, 0.90, 0.92]);
    } else {
      let a = Math.PI / 2; // starts at the top
      PIE.forEach(s => {
        if ((s.value as number) <= 0) return;
        const a1 = a + ((s.value as number) / pieTotal) * 2 * Math.PI;
        sector(cx, cy, R, a, a1, s.color);
        a = a1;
      });
    }
    // legenda à direita
    let ly = yy - 26;
    PIE.forEach(s => {
      rect(220, ly - 8, 11, 11, s.color);
      txt(238, ly, 12, F1, PDF.INK, s.label);
      txt(430, ly, 12, F2, PDF.INK, s.value + (pieTotal ? '  (' + Math.round(((s.value as number) / pieTotal) * 100) + '%)' : ''));
      ly -= 26;
    });
    yy = cy - R - 18;

    section('Totais do mês');
    ALL_FIELDS.forEach(f => row(f.label, num(t[f.key])));
    yy -= 6;
    if (weeks.length) {
      section('Por semana');
      weeks.forEach(w => {
        const d = parseISO(w.week);
        row('Semana ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1),
          w.aprovadas + ' aprov · ' + w.reprovadas + ' reprov · ' + w.dias + ' dia(s)');
      });
    }
    line(40, 54, 555, PDF.LIGHT);
    let quando = ''; try { quando = new Date().toLocaleString('pt-BR'); } catch (e) {}
    txt(40, 40, 9, F1, PDF.MUTED, 'Gerado em ' + quando + '  ·  App Relatório Diário');
  });
}

export function shareMonthPDF(monthKey: string) {
  const blob = buildMonthPDF(monthKey);
  downloadOrShare(blob, 'Resumo_' + monthKey + '.pdf', 'application/pdf');
}

export function downloadOrShare(blob: Blob, fname: string, mime: string) {
  try {
    const file = new File([blob], fname, { type: mime });
    if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
      // If sharing fails (e.g. no user gesture) or is cancelled → download the file instead.
      (navigator as any).share({ files: [file], title: fname })
        .catch(() => baixarArquivo(blob, fname));
      return;
    }
  } catch (e) { /* cai no download abaixo */ }
  baixarArquivo(blob, fname);
}

export function baixarArquivo(blob: Blob, fname: string) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast('Salvo em Downloads: ' + fname, 'ok');
  } catch (e) {
    toast('Não foi possível salvar o arquivo', 'err');
  }
}
