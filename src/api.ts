import type { Report, Customer, CustomerEvent, PhotoMeta } from './types.js';
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

/* ---------- Relatório a partir de uma foto (leitura por IA) ---------- */
// Estado da feature para o usuário logado (cota, admin, ambiente). Null = sem
// conexão/sessão — a barra mostra "verificando" (o servidor decide de qualquer jeito).
export async function aiPhotoMeta(): Promise<PhotoMeta | null> {
  if (!API_BASE || !sessionValid() || !isOnline()) return null;
  try {
    const res = await fetch(apiUrl('/api/reports?aiUsage=1'), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return null; }
    const data = await res.json();
    return data && data.ok ? (data.meta as PhotoMeta) : null;
  } catch (e) { return null; }
}

// Envia a foto (JPEG em base64), o servidor lê com o Claude e devolve um rascunho.
// NÃO grava nada — o app preenche os campos do formulário para conferência.
export async function sendPhotoReport(
  imageBase64: string, mediaType: string,
): Promise<{ draft: Record<string, any>; meta: PhotoMeta | null }> {
  if (!API_BASE) throw new Error('API não configurada.');
  const res = await fetch(apiUrl('/api/reports'), {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ photo: { imageBase64, mediaType } }),
  });
  if (res.status === 401) { refreshSession(); throw new Error('sessão expirada'); }
  const data = await res.json();
  if (!data.ok) {
    const err: any = new Error(data.error || 'Erro ao ler a foto');
    err.meta = data.meta || null;
    throw err;
  }
  return { draft: data.draft || {}, meta: data.meta || null };
}

// Liga/desliga a cota (admin, só no ambiente de teste — o back-end recusa o resto).
export async function setAiQuota(enabled: boolean): Promise<PhotoMeta | null> {
  if (!API_BASE) throw new Error('API não configurada.');
  const res = await fetch(apiUrl('/api/reports'), {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ aiConfig: { quotaEnabled: enabled } }),
  });
  if (res.status === 401) { refreshSession(); throw new Error('sessão expirada'); }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'não foi possível alterar a cota');
  return (data.meta as PhotoMeta) || null;
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

/* ---------- Customers (entidade única: agenda WhatsApp + cadastro Nosso Cartão) ---------- */
// Lista geral — usada pela tela de Clientes e pelo picker de Mensagens. Mesmo padrão de
// pullTemplates: cacheada em state, pra abrir a tela sem tela em branco mesmo offline/antes
// da resposta chegar.
export async function pullCustomers() {
  if (!API_BASE || !sessionValid() || !isOnline()) return;
  try {
    const res = await fetch(apiUrl('/api/customers'), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return; }
    const data = await res.json();
    if (data && data.ok) { state.customers = data.customers || []; save(LS.customers, state.customers); }
  } catch (e) {}
}

// Detalhe de um customer: cadastro + histórico completo de eventos (herdado da digitalização
// das fotos ou registrado pelo app), usado na tela de Clientes ao tocar num customer.
export async function getCustomerDetalhe(id: string | number): Promise<{ customer: Customer; events: CustomerEvent[] } | null> {
  if (!API_BASE || !sessionValid()) return null;
  try {
    const res = await fetch(apiUrl('/api/customers?id=' + encodeURIComponent(String(id))), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); return null; }
    const data = await res.json();
    if (!data || !data.ok) return null;
    return { customer: data.customer, events: data.events || [] };
  } catch (e) { return null; }
}

// Cria ou edita um customer. payload.id presente = edita; ausente = cria (ou completa, se a
// sequência já existir — upsert do lado do servidor).
export async function saveCustomer(payload: {
  id?: string | number; name?: string; phone?: string; email?: string;
  gender?: string; sequencia?: string; limite?: string | number;
}): Promise<{ ok: boolean; customer?: Customer; error?: string }> {
  if (!API_BASE || !sessionValid()) return { ok: false, error: 'sem conexão' };
  try {
    const res = await fetch(apiUrl('/api/customers'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ customer: payload }),
    });
    if (res.status === 401) { refreshSession(); return { ok: false, error: 'sessão expirada' }; }
    const data = await res.json();
    return data.ok ? { ok: true, customer: data.customer } : { ok: false, error: data.error };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// Exclui um customer.
export async function deleteCustomer(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!API_BASE || !sessionValid()) return { ok: false, error: 'sem conexão' };
  try {
    const res = await fetch(apiUrl('/api/customers?id=' + encodeURIComponent(String(id))), {
      method: 'DELETE', headers: authHeaders(),
    });
    if (res.status === 401) { refreshSession(); return { ok: false, error: 'sessão expirada' }; }
    const data = await res.json();
    return data.ok ? { ok: true } : { ok: false, error: data.error };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// Registra uma nova nota/evento no histórico de um customer (proposta aprovada/reprovada, link
// pendente, nota geral...), feito pelo app — complementa o que veio da digitalização das fotos.
// Mesmo endpoint de saveCustomer (/api/customers) — o plano Hobby da Vercel limita a 12
// Serverless Functions por deployment, então isso vive na mesma função, distinguido pelo
// corpo do POST ({ event } vs { customer }).
export async function addCustomerEvent(payload: {
  customerId: string | number; tipo: string; observacao: string; dataEvento?: string; retornarEm?: string; loja?: string;
}): Promise<{ ok: boolean; event?: CustomerEvent; error?: string }> {
  if (!API_BASE || !sessionValid()) return { ok: false, error: 'sem conexão' };
  try {
    const res = await fetch(apiUrl('/api/customers'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ event: payload }),
    });
    if (res.status === 401) { refreshSession(); return { ok: false, error: 'sessão expirada' }; }
    const data = await res.json();
    return data.ok ? { ok: true, event: data.event } : { ok: false, error: data.error };
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

/* ---------- Shared settings in Neon (goals, promoter, store) ---------- */
export function businessSettings() {
  return {
    metas: state.metas,
    metaDia: Number(state.config.metaDia) || 3,
    promotora: state.config.promotora,
    promotoraGender: state.config.promotoraGender || 'feminino',
    loja: state.config.loja,
    headerColor: state.config.headerColor || '',
    birthDate: state.config.birthDate || '',
    diasTrabalho: state.config.diasTrabalho,
    customLists: state.customLists,
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
      if (['feminino', 'masculino', 'outro'].includes(s.promotoraGender)) state.config.promotoraGender = s.promotoraGender;
      if (s.loja) state.config.loja = s.loja;
      if (typeof s.headerColor !== 'undefined') state.config.headerColor = s.headerColor;
      if (typeof s.birthDate !== 'undefined') state.config.birthDate = s.birthDate;
      if (Array.isArray(s.diasTrabalho) && s.diasTrabalho.length === 7) state.config.diasTrabalho = s.diasTrabalho;
      if (Array.isArray(s.customLists)) { state.customLists = s.customLists; save(LS.customLists, state.customLists); }
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
  pullCustomers();         // pull the customer roster (Clientes screen + Messages picker)
  refreshFromCloud(true);
  flushQueue(true);
}
