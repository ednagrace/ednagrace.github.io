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

// Fato mais recente sobre um customer (proposta aprovada/reprovada, link pendente, nota
// solta...), herdado da digitalização das fotos do caderno da Edna ou registrado pelo app.
// Ver customer_events no schema do back-end.
export interface CustomerEvent {
  id?: string | number;
  tipo: string;
  dataEvento?: string | null;
  retornarEm?: string | null;
  loja?: string | null;
  observacao?: string | null;
  confianca?: 'alta' | 'media' | 'baixa' | null;
}

// Customer: entidade única que funde o antigo "contato" (agenda de WhatsApp) com o antigo
// "cliente" (cadastro Nosso Cartão — sequência, limite). Todos os campos são opcionais: nem
// todo customer tem sequência/limite (não é cliente formal), nem todo customer tem
// telefone/email (cadastro antigo, sem contato).
export interface Customer {
  id?: string | number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  gender?: '' | 'masculino' | 'feminino' | 'outro' | null;
  sequencia?: string | null;
  limite?: number | string | null;
  ultimoEvento?: CustomerEvent | null;
}

export type TemplateGender = 'feminino' | 'masculino' | 'outro';

export interface Template {
  id?: string | number;
  title: string;
  body: string;
  // null / ausente = "sem gênero" — valor distinto de 'outro', mas o filtro "Outro" mostra os dois.
  gender?: TemplateGender | null;
}

// Lista customizada de clientes pra envio de template em massa (Mensagens → Lista). Diferente
// das categorias fixas (calculadas na hora a partir do último evento de cada customer), listas
// customizadas guardam os membros explicitamente e são sincronizadas via /api/settings.
export interface CustomList {
  id: string;
  name: string;
  customerIds: (string | number)[];
}

export interface Session {
  token?: string;
  email?: string;
  name?: string;
  exp?: number;
}

export interface Config {
  promotora: string;
  // Gênero de quem faz as consultas (Edna é 'feminino'). Usado no placeholder {cargo}
  // dos templates: promotora / promotor / promotore.
  promotoraGender: TemplateGender;
  loja: string;
  metaDia: number;
  headerColor: string;
  birthDate: string;
  // Which weekdays count as work days (lembrete de relatório diário). Index = Date.getDay()
  // (0 = domingo … 6 = sábado).
  diasTrabalho: boolean[];
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
  gender: TemplateGender | null;
}

export type ViewName = 'list' | 'form' | 'panel' | 'msg' | 'import' | 'customers';

export interface AppState {
  config: Config;
  reports: Report[];
  queue: Report[];
  metas: Record<string, number>;
  session: Session;
  templates: Template[];
  customers: Customer[];
  customLists: CustomList[];
  msg: MsgState;
  // Tela de Mensagens: pra quem enviar — 1 pessoa (customerId) ou uma lista. Estado só de tela,
  // não persiste — volta pra 'pessoa' toda vez que a tela de Mensagens é aberta de novo.
  msgDestMode: 'pessoa' | 'lista';
  // Tela de Mensagens: filtro do seletor de templates pelo atributo `gender` do template
  // (feminino → 'f', masculino → 'm', outro → 'o'). '' = sem filtro. Só de tela, não persiste.
  msgGender: '' | 'f' | 'm' | 'o';
  customerId: string | number | null;
  imp: ImportState;
  view: ViewName;
  month: string; // 'YYYY-MM'
  search: string;
  editing: Report | null;
  editingNew?: boolean;
  syncing: boolean;
  // Customers screen: true when opened as a picker from Messages (tap-to-select-and-return)
  // instead of from the menu (tap-to-open-detail). Own search box, separate from the report
  // list's.
  customersPickMode: boolean;
  customersSearch: string;
  // Padrão: só mostra quem "parece WhatsApp" (looksLikeWhatsApp) — existem customers sem
  // telefone, ou com telefone fixo, que nunca receberiam mensagem por esta tela.
  customersWhatsappOnly: boolean;
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
