import type { Group, Field } from './types.js';

/* ---------- Report field definitions ---------- */
export const GROUPS: Group[] = [
  {
    title: 'Abordagem', emoji: '👥', fields: [
      { key: 'clientesAbordados', label: 'Clientes Abordados', emoji: '👥' },
    ]
  },
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
export const APP_VERSION = 'v48'; // bump together with sw.js's CACHE on every release
export const ADMIN_EMAIL = 'jpantunesdesouza@gmail.com';

export const DEFAULT_META = 22; // default monthly goal for approved proposals (editable)
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SUPORTE_WPP = '5519999974213'; // 55 (BR) + 19 99997-4213
