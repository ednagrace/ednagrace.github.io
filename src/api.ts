import type { Report, Cliente, ClienteEvento } from './types.js';
import { API_BASE, apiUrl } from './env.js';
import { LS } from './env.js';
import { state, save, sessionValid } from './state.js';
import { applyHeaderColor } from './theme.js';
import { render } from './render.js';
import { toast } from './ui.js';
import { parseISO, pad } from './dateUtils.js';
import { refreshSession } from './auth.js';
import { CARTAO_TEMPLATE_TITLE, CARTAO_TEMPLATE_BODY, ODONTO_PLUS_TEMPLATE_TITLE, ODONTO_PLUS_TEMPLATE_BODY } from './constants.js';

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

// Live search, not cached in state (results are ephemeral, shown while typing in the
// cliente-link picker). Empty query short-circuits to avoid listing the whole table.
export async function searchClientes(q: string): Promise<Cliente[]> {
  if (!API_BASE || !sessionValid() || !q.trim()) return [];
  try {
    const res = await fetch(apiUrl('/api/clientes?q=' + encodeURIComponent(q.trim())), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return []; }
    const data = await res.json();
    return (data && data.ok && data.clientes) || [];
  } catch (e) { return []; }
}

// Lista geral do cadastro de clientes da Edna — usada pela tela de Clientes (existem clientes
// sem contato/telefone vinculado, que nunca apareceriam navegando só pela agenda). Mesmo
// padrão de pullContacts/pullTemplates: cacheada em state, pra abrir a tela sem tela em branco
// mesmo offline/antes da resposta chegar.
export async function pullClientes() {
  if (!API_BASE || !sessionValid() || !isOnline()) return;
  try {
    const res = await fetch(apiUrl('/api/clientes'), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return; }
    const data = await res.json();
    if (data && data.ok) { state.clientes = data.clientes || []; save(LS.clientes, state.clientes); }
  } catch (e) {}
}

// Detalhe de um cliente: cadastro + histórico completo de eventos (herdado da digitalização
// das fotos), usado na tela de Clientes ao tocar num cliente.
export async function getClienteDetalhe(id: string | number): Promise<{ cliente: Cliente; eventos: ClienteEvento[] } | null> {
  if (!API_BASE || !sessionValid()) return null;
  try {
    const res = await fetch(apiUrl('/api/clientes?id=' + encodeURIComponent(String(id))), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return null; }
    const data = await res.json();
    if (!data || !data.ok) return null;
    return { cliente: data.cliente, eventos: data.eventos || [] };
  } catch (e) { return null; }
}

// Cria ou edita um cliente direto (sem passar por um contato) — tela de Clientes.
// payload.id presente = edita esse cliente; ausente = cria (ou completa, se a sequência já
// existir — upsert do lado do servidor).
export async function saveCliente(payload: {
  id?: string | number; sequencia: string; nome?: string; telefone?: string; limite?: string | number;
}): Promise<{ ok: boolean; cliente?: Cliente; error?: string }> {
  if (!API_BASE || !sessionValid()) return { ok: false, error: 'sem conexão' };
  try {
    const res = await fetch(apiUrl('/api/clientes'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ cliente: payload }),
    });
    if (res.status === 401) { refreshSession(); return { ok: false, error: 'sessão expirada' }; }
    const data = await res.json();
    return data.ok ? { ok: true, cliente: data.cliente } : { ok: false, error: data.error };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// Registra uma nova nota/evento no histórico de um cliente (proposta aprovada/reprovada, link
// pendente, nota geral...), feito pelo app — complementa o que veio da digitalização das fotos.
// Mesmo endpoint de saveCliente (/api/clientes) — o plano Hobby da Vercel limita a 12
// Serverless Functions por deployment, então isso vive na mesma função, distinguido pelo
// corpo do POST ({ evento } vs { cliente }).
export async function addClienteEvento(payload: {
  clienteId: string | number; tipo: string; observacao: string; dataEvento?: string; retornarEm?: string; loja?: string;
}): Promise<{ ok: boolean; evento?: ClienteEvento; error?: string }> {
  if (!API_BASE || !sessionValid()) return { ok: false, error: 'sem conexão' };
  try {
    const res = await fetch(apiUrl('/api/clientes'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ evento: payload }),
    });
    if (res.status === 401) { refreshSession(); return { ok: false, error: 'sessão expirada' }; }
    const data = await res.json();
    return data.ok ? { ok: true, evento: data.evento } : { ok: false, error: data.error };
  } catch (e: any) { return { ok: false, error: e.message }; }
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

// Creates the "Nosso Cartão" template on the server the first time it's missing, so it
// shows up ready-made in the templates list without the promotora having to type it.
// Title is the de-dup key — safe to call on every login/boot.
export async function ensureCartaoTemplate() {
  if (!API_BASE || !sessionValid() || !isOnline()) return;
  if (state.templates.some(t => t.title === CARTAO_TEMPLATE_TITLE)) return;
  try {
    const res = await fetch(apiUrl('/api/templates'), {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ template: { title: CARTAO_TEMPLATE_TITLE, body: CARTAO_TEMPLATE_BODY } }),
    });
    if (res.status === 401) { refreshSession(); return; }
    const data = await res.json();
    if (data && data.ok) await pullTemplates();
  } catch (e) {}
}

// Same idea as ensureCartaoTemplate — creates the "Odonto Plus" offer template the first
// time it's missing, so it's ready-made in the templates list without manual copy-paste.
export async function ensureOdontoPlusTemplate() {
  if (!API_BASE || !sessionValid() || !isOnline()) return;
  if (state.templates.some(t => t.title === ODONTO_PLUS_TEMPLATE_TITLE)) return;
  try {
    const res = await fetch(apiUrl('/api/templates'), {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ template: { title: ODONTO_PLUS_TEMPLATE_TITLE, body: ODONTO_PLUS_TEMPLATE_BODY } }),
    });
    if (res.status === 401) { refreshSession(); return; }
    const data = await res.json();
    if (data && data.ok) await pullTemplates();
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
  await pullTemplates();   // pull message templates
  ensureCartaoTemplate();  // make sure "Nosso Cartão" is there to pick from
  ensureOdontoPlusTemplate(); // same for the Odonto Plus offer template
  pullContacts();          // pull contacts
  pullClientes();          // pull the client roster (Clientes screen)
  refreshFromCloud(true);
  flushQueue(true);
}
