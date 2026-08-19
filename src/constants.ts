import type { Group, Field } from './types.js';

/* ---------- Report field definitions ---------- */
export const GROUPS: Group[] = [
  {
    title: 'Propostas', emoji: '📋', fields: [
      { key: 'aprovadas',  label: 'Aprovadas',   emoji: '✅', dailyMeta: true },
      { key: 'preAprovado',label: 'Pré-Aprovado',emoji: '🟡' },
      { key: 'reprovadas', label: 'Reprovadas',  emoji: '❌' },
      { key: 'analise',    label: 'Em Análise',  emoji: '🔍' },
      { key: 'pendencias', label: 'Pendências',  emoji: '⏳' },
    ]
  },
  {
    title: 'Links', emoji: '🔗', fields: [
      { key: 'link', label: 'Links', emoji: '🔗' },
    ]
  },
  {
    title: 'Cartão', emoji: '💳', fields: [
      { key: 'cartaoEntregas', label: 'Entregas',  emoji: '📦' },
      { key: 'cartaoReceber',  label: 'A Receber', emoji: '🕓' },
      { key: 'cartaoAtivacao', label: 'Ativação',  emoji: '✅' },
    ]
  },
  {
    title: 'Serviços', emoji: '⭐', fields: [
      { key: 'sms',           label: 'SMS',            emoji: '💬' },
      { key: 'bonus',         label: 'Bônus',          emoji: '🎁' },
      { key: 'faturaDigital', label: 'Fatura Digital', emoji: '📄' },
      { key: 'odontoPlus',    label: 'Odonto Plus',    emoji: '🦷' },
    ]
  },
];
export const ALL_FIELDS: Field[] = GROUPS.flatMap(g => g.fields);
export const NUMERIC_KEYS: string[] = ALL_FIELDS.map(f => f.key);
export const PROPOSTAS_KEYS: string[] = GROUPS.find(g => g.title === 'Propostas')!.fields.map(f => f.key);

export const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const MONTHS_SHORT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

export interface EnvDef { label: string; api: string }
export const ENVS: Record<'prod' | 'staging', EnvDef> = {
  prod: {
    label: 'Produção',
    api: 'https://relatorio-api.vercel.app',
  },
  staging: {
    label: 'Teste',
    api: 'https://relatorio-api-git-staging-joaopauloantunes-projects.vercel.app',
  },
};

// Allowlisted emails (the back-end also checks this — here it's just for UX).
export const ALLOWLIST = [
  'ednapromotora69@gmail.com',
  'edna.cristina.g69@gmail.com',
  'jpantunesdesouza@gmail.com',
];

export const GOOGLE_CLIENT_ID = '81605218542-e00ff2h9oontd7vrtic5gpt0cf0but6u.apps.googleusercontent.com';
export const APP_VERSION = 'v52'; // bump together with sw.js's CACHE on every release
export const ADMIN_EMAIL = 'jpantunesdesouza@gmail.com';

export const DEFAULT_META = 22; // default monthly goal for approved proposals (editable)
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SUPORTE_WPP = '5519999974213'; // 55 (BR) + 19 99997-4213

// "Nosso Cartão" link — quick WhatsApp share to clients.
export const NOSSO_CARTAO_URL = 'https://nossocartaoacs.com.br/nosso-cartao';
// Title doubles as the de-dup key when auto-creating this template server-side (see api.ts).
export const CARTAO_TEMPLATE_TITLE = 'Nosso Cartão (link)';
export const CARTAO_TEMPLATE_BODY =
  '{saudacao}, {contato}! 💳\n\n' +
  'Aqui está o link para você solicitar o Nosso Cartão:\n' + NOSSO_CARTAO_URL + '\n\n' +
  'À disposição!';
// Independent wording for the menu's quick-send button — no {contato}, since that flow
// often has no contact selected (would print an empty name right after the greeting).
export const CARTAO_QUICK_BODY =
  '{saudacao}! 💳\n\n' +
  'Segue o link para solicitar o Nosso Cartão:\n' + NOSSO_CARTAO_URL + '\n\n' +
  'À disposição!';

// Oferta do plano odontológico Odonto Plus — mesmo esquema do Nosso Cartão (título é a
// chave de dedup ao criar automaticamente, ver ensureOdontoPlusTemplate em api.ts). Números
// e benefícios vieram do panfleto oficial do Odonto Plus (sempreodonto, via Nosso Cartão).
export const ODONTO_PLUS_TEMPLATE_TITLE = 'Odonto Plus (oferta)';
export const ODONTO_PLUS_TEMPLATE_BODY =
  '{saudacao}, {contato}! 🦷✨\n\n' +
  'Quero te apresentar o *Odonto Plus* — o plano odontológico do Nosso Cartão:\n\n' +
  '🚨 SOS Odonto 24h (teleurgência para dor de dente)\n' +
  '🎟️ 4 sorteios mensais de R$ 2.500,00\n' +
  '💊 Até 45% de desconto em medicamentos (Pacheco, São Paulo, Pague Menos, Extrafarma, Raia, Drogasil e mais)\n' +
  '🦷 Mais de 250 procedimentos: consultas, cirurgias, canal, próteses e mais\n\n' +
  'Pode incluir até 4 dependentes, sem limite de idade:\n' +
  '👤 Titular: R$ 32,70/mês\n' +
  '👥 +1 dependente: R$ 63,00/mês\n' +
  '👥 +2 dependentes: R$ 91,50/mês\n' +
  '👥 +3 dependentes: R$ 115,50/mês\n' +
  '👥 +4 dependentes: R$ 120,30/mês\n\n' +
  'Quer que eu já faça sua adesão pelo app Nosso Cartão? É rapidinho! 😊\n\n' +
  '{promotora}';
