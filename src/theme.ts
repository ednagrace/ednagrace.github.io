import { IS_STAGING } from './env.js';
import { state } from './state.js';

/* ---------------- Header color (PRODUCTION only) ----------------
   The color is saved in the database (settings), so it's the same on every device.
   The TEST environment doesn't pick a color: it's always amber, so it's never
   confused with production. That's why there's no cross-environment check — the
   only rule is "production can't be amber", enforced by validateHeaderColor. */
export const DEFAULT_HEADER = '#e8734e';   // brand coral
export const TEST_AMBER = '#e08a00';

export interface RGB { r: number; g: number; b: number }

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function relLum({ r, g, b }: RGB): number {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function hueOf({ r, g, b }: RGB): number {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
// null = ok; otherwise, the reason (to show the user).
export function validateHeaderColor(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'cor inválida';
  // Header text is white and large/bold, so require WCAG AA for large text (>= 3:1).
  // This admits vibrant brand tones like the coral while still rejecting pale colors.
  if (1.05 / (relLum(rgb) + 0.05) < 3) return 'clara demais — o texto branco do cabeçalho fica ilegível';
  // Orange/amber/yellow hue range: reserved for the test environment.
  const h = hueOf(rgb);
  if (h >= 30 && h <= 70) return 'parecida com o âmbar do ambiente de teste — escolha outra família de cor';
  return null;
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
export const hslToRgb = (h: number, s: number, l: number) => hexToRgb(hslToHex(h, s, l));

// Paint-style swatch grid: a spectrum of header-ready colors. Built by sweeping the hue
// wheel at two lightness levels and KEEPING ONLY what passes validateHeaderColor (enough
// contrast for white text, and never the reserved test amber). The brand coral leads.
export const HEADER_PALETTE: { nome: string; cor: string }[] = (() => {
  const out = [{ nome: 'Coral', cor: DEFAULT_HEADER }];
  for (const l of [34, 46]) {
    for (let h = 0; h < 360; h += 15) {
      const cor = hslToHex(h, 72, l);
      if (!validateHeaderColor(cor) && !out.some((o) => o.cor === cor)) {
        out.push({ nome: cor, cor });
      }
    }
  }
  // A few neutrals to round it out (like Paint's grey row).
  ['#4b5563', '#37414f', '#263238', '#111827'].forEach((cor) => out.push({ nome: cor, cor }));
  return out;
})();

// Primary base colors (a quick row, like Paint's basic colors). All header-valid.
export const PRIMARIES = ['#d10a11', '#e8734e', '#b02a6b', '#8e24aa', '#5e35b1',
  '#1b52c0', '#0277bd', '#0f6f7f', '#1e7d45', '#37414f'];

// The color the header should have right now. In staging, null (CSS forces amber).
export function currentHeaderColor(): string | null {
  if (IS_STAGING) return null;
  const c = state.config.headerColor;
  return (c && !validateHeaderColor(c)) ? c : DEFAULT_HEADER;
}
// Mixes a hex color toward black (amount < 0) or white (amount > 0), |amount| in [0,1].
export function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const h = (v: number) => Math.round(v + (target - v) * t).toString(16).padStart(2, '0');
  return '#' + h(rgb.r) + h(rgb.g) + h(rgb.b);
}
// Applies the configured color to the WHOLE identity: sets --header-color and derives the
// dark/soft shades (used by buttons, FAB, quick-select, login gradient…) plus the mobile
// status-bar color. Test environment is always amber.
export function applyHeaderColor() {
  const c = (IS_STAGING ? TEST_AMBER : currentHeaderColor()) as string;
  const root = document.documentElement.style;
  root.setProperty('--header-color', c);
  root.setProperty('--header-dark', shade(c, -0.22));
  root.setProperty('--header-soft', shade(c, 0.88));
  const rgb = hexToRgb(c) || { r: 20, g: 22, b: 30 };
  root.setProperty('--header-glow', `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`);
  // Note: the system status bar is intentionally left at the fixed dark theme-color from
  // index.html — it does NOT follow the header color (avoids the cached-color hairline).
}
