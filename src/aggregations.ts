import type { MonthTotals, WeekTotal } from './types.js';
import { NUMERIC_KEYS, DEFAULT_META } from './constants.js';
import { state, save } from './state.js';
import { LS } from './env.js';
import { monthKeyOf, parseISO, pad } from './dateUtils.js';
import { informed } from './format.js';
import { reportsForView } from './api.js';

/* ---------- Monthly goal ---------- */
export function metaFor(monthKey: string): number {
  // if the month hasn't had a goal set yet, use the default (22)
  return monthKey in state.metas ? (Number(state.metas[monthKey]) || 0) : DEFAULT_META;
}
export function metaDiaVal(): number { return Number(state.config.metaDia) || 3; } // daily goal (default 3)
export function setMeta(monthKey: string, val: any) {
  state.metas[monthKey] = Number(val) || 0;
  save(LS.metas, state.metas);
}
export function aprovadasNoMes(monthKey: string): number {
  return reportsForView()
    .filter(r => monthKeyOf(r.data) === monthKey)
    .reduce((sum, r) => sum + (Number(r.aprovadas) || 0), 0);
}

/* ---------- Aggregations (panel / summary) ---------- */
export function monthReports(monthKey: string) {
  return reportsForView().filter(r => monthKeyOf(r.data) === monthKey)
    .sort((a, b) => a.data.localeCompare(b.data));
}
export function monthTotals(monthKey: string): MonthTotals {
  const rows = monthReports(monthKey);
  const t: any = {};
  // Sum only the informed values. If NOBODY informed the field that month, the total is
  // N/A (null), not 0 — the panel shows "—".
  NUMERIC_KEYS.forEach(k => {
    let s = 0, any = false;
    rows.forEach(r => { if (informed(r[k])) { s += r[k] as number; any = true; } });
    t[k] = any ? s : null;
  });
  t._dias = rows.length;
  return t;
}
export function mondayOf(dateISO: string): string {
  const d = parseISO(dateISO);
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  d.setDate(d.getDate() - dow);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export function weeklyBreakdown(monthKey: string): WeekTotal[] {
  const map: Record<string, WeekTotal> = {};
  monthReports(monthKey).forEach(r => {
    const wk = mondayOf(r.data);
    if (!map[wk]) map[wk] = { week: wk, aprovadas: 0, reprovadas: 0, dias: 0 };
    map[wk].aprovadas += Number(r.aprovadas) || 0;
    map[wk].reprovadas += Number(r.reprovadas) || 0;
    map[wk].dias += 1;
  });
  return Object.values(map).sort((a, b) => a.week.localeCompare(b.week));
}

// Birth date is stored as 'YYYY-MM-DD'. It's a birthday when day/month match today.
export function isBirthday(): boolean {
  const dob = state.config.birthDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return false;
  const now = new Date();
  return dob.slice(5) === pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}
// Age turned today (only meaningful when isBirthday()).
export function ageToday(): number | null {
  const dob = state.config.birthDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return null;
  return new Date().getFullYear() - Number(dob.slice(0, 4));
}
