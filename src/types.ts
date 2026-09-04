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

// Rascunho de cliente lido de uma foto (ficha/cadastro/anotação) pelo Claude —
// vem do back-end (POST /api/customers { customerPhoto }). Não persiste: o app
// preenche o formulário de "Novo cliente" para a promotora conferir e salvar.
export interface CustomerDraft {
  name?: string;
  phone?: string;
  email?: string;
  sequencia?: string;
  limite?: number | null;
  gender?: '' | 'masculino' | 'feminino' | 'outro';
  nota?: string;
  notaTipo?: string;
}

// 'outro' = mensagem escrita para pessoas LGBTQIA+ (valor explícito, escolhido pela usuária).
// null / ausente = gênero não definido (a usuária não marcou nada).
// São estados distintos; só o filtro "Outro" junta os dois (em grupos separados).
export type TemplateGender = 'feminino' | 'masculino' | 'outro';

export interface Template {
  id?: string | number;
  title: string;
  body: string;
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
  // Acompanhar cartão PJ à parte (aba própria no formulário + meta mensal). A promotora
  // liga/desliga isso nas Configurações; desligado, o app não mostra nada de PJ.
  metaPJAtiva: boolean;
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

// Cota da leitura de relatório por foto (protege o crédito da API Claude).
// A semana começa na segunda-feira (horário de Brasília) — vem calculada do servidor.
export interface AiUsage {
  dia: number;
  semana: number;
  limiteDia: number;
  limiteSemana: number;
  podeUsar: boolean;
}

// Estado da feature "Preencher com uma foto" para o usuário logado (vem do back-end,
// que é a fonte da verdade sobre ambiente/admin).
export interface PhotoMeta {
  usage: AiUsage;
  quotaEnabled: boolean;   // cota sendo aplicada? (só o admin desliga, só no teste)
  isAdmin: boolean;
  staging: boolean;
  allowed: boolean;        // pode usar a feature aqui? (no teste, só o admin)
  canToggleQuota: boolean; // vê e mexe no liga/desliga da cota? (admin + teste)
}

// "Preencher com uma foto" (botão dentro do formulário): só de tela, não persiste.
export interface PhotoState {
  busy: boolean;
  meta: PhotoMeta | null;
  error: string;
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
  metasPJ: Record<string, number>;   // { 'YYYY-MM': number } — meta mensal de cartão PJ
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
  // Também é a classificação usada ao salvar um template — vem do cadastro do cliente.
  msgGender: '' | 'f' | 'm' | 'o';
  customerId: string | number | null;
  imp: ImportState;
  photo: PhotoState;
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
  // Filtro de gênero na lista de Clientes ('' = todos). Só de tela, não persiste.
  customersGender: '' | 'masculino' | 'feminino' | 'outro';
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
