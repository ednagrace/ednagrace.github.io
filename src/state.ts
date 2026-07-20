import type { AppState, Config } from './types.js';
import { LS } from './env.js';
import { currentMonthKey } from './dateUtils.js';

export function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) as string) ?? fallback; }
  catch (e) { return fallback; }
}
export function save(key: string, val: any) { localStorage.setItem(key, JSON.stringify(val)); }

const defaultConfig: Config = {
  promotora: 'Edna Grace',
  loja:     'Savegnago',
  metaDia:  3,                  // daily goal for approved cards (editable)
  headerColor: '',             // header color (production only); empty = brand red
  birthDate: '',               // 'YYYY-MM-DD' — promotora's date of birth
};

export const state: AppState = {
  config:  Object.assign({}, defaultConfig, load(LS.config, {})),
  reports: load(LS.reports, []),        // local report cache
  queue:   load(LS.queue, []),          // reports waiting to be sent (offline)
  metas:   load(LS.metas, {}),          // { 'YYYY-MM': number }
  session: load(LS.session, {}),        // { token, email, name, exp }
  templates: load(LS.templates, []),    // [{ id, title, body }]
  contacts: load(LS.contacts, []),      // [{ id, name, phone, email, gender }]
  msg:     { id: null, title: '', body: '' },
  contatoId: null,                      // contact selected on the Messages screen
  imp:     { file: null, fileName: '', sheetUrl: '', preview: null, busy: false },
  view:    'list',
  month:   currentMonthKey(),
  search:  '',
  editing: null,                        // report currently being edited in the form
  syncing: false,
};

export function sessionValid(): boolean {
  return !!(state.session && state.session.token && state.session.exp &&
           (state.session.exp * 1000 > Date.now()));
}
