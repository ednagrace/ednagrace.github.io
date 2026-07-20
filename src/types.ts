// Formatos de dados compartilhados pelo app inteiro.

export interface Field {
  key: string;
  label: string;
  emoji: string;
  dailyMeta?: boolean;
}

export interface Group {
  title: string;
  emoji: string;
  fields: Field[];
}

// A daily report. The numeric fields (see NUMERIC_KEYS in constants.ts) hold a
// number when informed, or null when "N/A" (not 0 — "not filled in").
export interface Report {
  data: string; // 'YYYY-MM-DD', primary key
  promotora?: string;
  loja?: string;
  metaMes?: number;
  obs?: string;
  _synced?: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

export interface Contact {
  id?: string | number;
  name?: string;
  phone?: string;
  email?: string;
  gender?: '' | 'masculino' | 'feminino' | 'outro';
}

export interface Template {
  id?: string | number;
  title: string;
  body: string;
}

export interface Session {
  token?: string;
  email?: string;
  name?: string;
  exp?: number;
}

export interface Config {
  promotora: string;
  loja: string;
  metaDia: number;
  headerColor: string;
  birthDate: string;
}

export interface ImportState {
  file: File | null;
  fileName: string;
  sheetUrl: string;
  preview: any;
  busy: boolean;
}

export interface MsgState {
  id: string | number | null;
  title: string;
  body: string;
}

export type ViewName = 'list' | 'form' | 'panel' | 'msg' | 'import';

export interface AppState {
  config: Config;
  reports: Report[];
  queue: Report[];
  metas: Record<string, number>;
  session: Session;
  templates: Template[];
  contacts: Contact[];
  msg: MsgState;
  contatoId: string | number | null;
  imp: ImportState;
  view: ViewName;
  month: string; // 'YYYY-MM'
  search: string;
  editing: Report | null;
  editingNew?: boolean;
  syncing: boolean;
}

export interface WeekTotal {
  week: string;
  aprovadas: number;
  reprovadas: number;
  dias: number;
}

export interface MonthTotals {
  _dias: number;
  [key: string]: number | null;
}
