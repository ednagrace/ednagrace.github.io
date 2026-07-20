import type { Report } from './types.js';
import { API_BASE, apiUrl } from './env.js';
import { LS } from './env.js';
import { state, save, sessionValid } from './state.js';
import { applyHeaderColor } from './theme.js';
import { render } from './render.js';
import { toast } from './ui.js';
import { parseISO, pad } from './dateUtils.js';
import { refreshSession } from './auth.js';

export function isOnline(): boolean { return navigator.onLine; }
export function authHeaders(): Record<string, string> {
  return { 'Authorization': 'Bearer ' + (state.session.token || ''), 'Content-Type': 'application/json' };
}

/* ---------- Reports ---------- */
export async function apiList(): Promise<Report[] | null> {
  if (!API_BASE || !sessionValid()) return null;
  const res = await fetch(apiUrl('/api/reports'), { headers: authHeaders() });
  if (res.status === 401) { refreshSession(); throw new Error('sessão expirada'); }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao listar');
  return data.reports || [];
}

export async function apiSave(report: Report) {
  if (!API_BASE) throw new Error('API não configurada.');
  const res = await fetch(apiUrl('/api/reports'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ report }),
  });
  if (res.status === 401) { refreshSession(); throw new Error('sessão expirada'); }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao salvar');
  return data;
}

export async function apiDelete(dataISO: string) {
  const res = await fetch(apiUrl('/api/reports?data=' + encodeURIComponent(dataISO)), {
    method: 'DELETE', headers: authHeaders(),
  });
  if (res.status === 401) { refreshSession(); throw new Error('sessão expirada'); }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao excluir');
  return data;
}

/* ---------- Contacts ---------- */
export async function pullContacts() {
  if (!API_BASE || !sessionValid() || !isOnline()) return;
  try {
    const res = await fetch(apiUrl('/api/contacts'), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return; }
    const data = await res.json();
    if (data && data.ok) { state.contacts = data.contacts || []; save(LS.contacts, state.contacts); }
  } catch (e) {}
}

/* ---------- WhatsApp message templates ---------- */
export async function pullTemplates() {
  if (!API_BASE || !sessionValid() || !isOnline()) return;
  try {
    const res = await fetch(apiUrl('/api/templates'), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return; }
    const data = await res.json();
    if (data && data.ok) { state.templates = data.templates || []; save(LS.templates, state.templates); }
  } catch (e) {}
}

/* ---------- Shared settings in Neon (goals, promoter, store) ---------- */
export function businessSettings() {
  return {
    metas: state.metas,
    metaDia: Number(state.config.metaDia) || 3,
    promotora: state.config.promotora,
    loja: state.config.loja,
    headerColor: state.config.headerColor || '',
    birthDate: state.config.birthDate || '',
  };
}
// Called when the user changes a goal or a setting: stashes it as pending and tries to send it.
export function saveSettingsRemote() {
  save(LS.settingsPending, businessSettings());
  flushSettings();
}
export async function flushSettings() {
  const pending: any = JSON.parse(localStorage.getItem(LS.settingsPending) || 'null');
  if (!pending || !API_BASE || !sessionValid() || !isOnline()) return;
  try {
    const res = await fetch(apiUrl('/api/settings'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ settings: pending }),
    });
    if (res.ok) localStorage.removeItem(LS.settingsPending);
  } catch (e) {}
}
// Pulls settings from Neon and applies them (shared source across devices/logins).
export async function pullSettings() {
  if (!API_BASE || !sessionValid() || !isOnline()) return;
  try {
    const res = await fetch(apiUrl('/api/settings'), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return; }
    const data = await res.json();
    if (data && data.ok && data.settings) {
      const s = data.settings;
      if (s.metas && typeof s.metas === 'object') { state.metas = Object.assign({}, s.metas); save(LS.metas, state.metas); }
      if (typeof s.metaDia !== 'undefined') state.config.metaDia = Number(s.metaDia) || 0;
      if (s.promotora) state.config.promotora = s.promotora;
      if (s.loja) state.config.loja = s.loja;
      if (typeof s.headerColor !== 'undefined') state.config.headerColor = s.headerColor;
      if (typeof s.birthDate !== 'undefined') state.config.birthDate = s.birthDate;
      save(LS.config, state.config);
      applyHeaderColor();   // the color may have changed on another device
      render();
    }
  } catch (e) {}
}

/* ---------- Offline queue ---------- */
export function enqueue(report: Report) {
  // replaces any item for the same date already in the queue
  state.queue = state.queue.filter(r => r.data !== report.data);
  state.queue.push(report);
  save(LS.queue, state.queue);
}

export async function flushQueue(silent?: boolean) {
  if (state.syncing || !isOnline() || !API_BASE || !sessionValid()) return;
  if (state.queue.length === 0) return;
  state.syncing = true;
  const pending = state.queue.slice();
  for (const report of pending) {
    try {
      await apiSave(report);
      state.queue = state.queue.filter(r => r.data !== report.data);
      save(LS.queue, state.queue);
    } catch (e) { break; } // stop at the first failure; retry later
  }
  state.syncing = false;
  if (!silent && state.queue.length === 0) toast('Tudo sincronizado ✓', 'ok');
  render();
}

export async function refreshFromCloud(silent?: boolean) {
  if (!API_BASE || !isOnline() || !sessionValid()) return;
  try {
    const remote = await apiList();
    if (remote) {
      state.reports = remote;
      save(LS.reports, state.reports);
      render();
    }
  } catch (e) {
    if (!silent) toast('Sem conexão com o servidor', 'err');
  }
}

/* Merges cache + queue for display (queue wins = newer version). */
export function reportsForView(): Report[] {
  const map: Record<string, Report> = {};
  state.reports.forEach(r => { map[r.data] = Object.assign({}, r, { _synced: true }); });
  state.queue.forEach(r => { map[r.data] = Object.assign({}, r, { _synced: false }); });
  return Object.values(map).sort((a, b) => b.data.localeCompare(a.data));
}

export function getReport(dataISO: string): Report | null {
  const q = state.queue.find(r => r.data === dataISO);
  if (q) return Object.assign({}, q);
  const c = state.reports.find(r => r.data === dataISO);
  if (c) return Object.assign({}, c);
  return null;
}

export function upsertCache(r: Report) {
  const i = state.reports.findIndex(x => x.data === r.data);
  if (i >= 0) state.reports[i] = Object.assign({}, r);
  else state.reports.push(Object.assign({}, r));
  save(LS.reports, state.reports);
}

// Deletes for real (no confirmation). Used by swipe — the gesture itself is the confirmation.
export async function deleteReportNow(dataISO: string): Promise<boolean> {
  try {
    await apiDelete(dataISO);
    state.reports = state.reports.filter(x => x.data !== dataISO);
    state.queue = state.queue.filter(x => x.data !== dataISO);
    save(LS.reports, state.reports);
    save(LS.queue, state.queue);
    return true;
  } catch (e) {
    return false;
  }
}

// Delete WITH confirmation — used by the 🗑️ button in the form.
export async function deleteReportByDate(dataISO: string): Promise<boolean> {
  if (!getReport(dataISO)) return false;
  const d = parseISO(dataISO);
  const quando = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  if (!window.confirm('Excluir o relatório de ' + quando + '?\n\nEsta ação não pode ser desfeita.')) return false;
  if (!isOnline() || !sessionValid()) { toast('Conecte à internet para excluir', 'err'); return false; }
  const ok = await deleteReportNow(dataISO);
  if (!ok) toast('Não foi possível excluir', 'err');
  return ok;
}

/* ---------------- General sync ---------------- */
// Syncs everything: sends pending items and pulls whatever's new (config + reports).
export function syncNow(silent?: boolean) {
  if (!isOnline() || !sessionValid()) return;
  flushSettings();
  pullSettings();
  flushQueue(silent !== false);
  refreshFromCloud(true);
}

export async function postAuthInit() {
  await flushSettings();   // send pending local changes (merged server-side)
  await pullSettings();    // pull the shared config
  pullTemplates();         // pull message templates
  pullContacts();          // pull contacts
  refreshFromCloud(true);
  flushQueue(true);
}
