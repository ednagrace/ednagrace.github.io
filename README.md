# Relatório Diário — Edna Grace / Savegnago

App de celular (PWA) para a promotora preencher o relatório diário de forma rápida:
botões de número (0–4, 5–9, 10–15) e botões **−/＋** para acertar a contagem de
propostas aprovadas, reprovadas, link, cartão, SMS, bônus etc.

- **Login com Google** (só emails autorizados) — a Edna loga **uma vez** e ganha uma
  sessão de **60 dias** (não precisa ficar logando).
- Dados guardados no **Neon (Postgres)**, via uma **API serverless na Vercel** (grátis).
- Funciona **offline**: sem internet, guarda no celular e envia sozinho depois.
- Gera **PDF** do dia para compartilhar no WhatsApp.

URL de produção: **https://ednagrace.github.io/**

---

## 🧱 Arquitetura

```
Celular (PWA, GitHub Pages: ednagrace.github.io)
      │  login Google (GIS)  →  /api/login  →  sessão 60 dias (JWT)
      │  Authorization: Bearer <sessão>
      ▼
API serverless (Vercel: repo ednagrace/relatorio-api)
      │  valida sessão + allowlist
      ▼
Neon Postgres (tabela reports)
```

Este repositório é **só o front-end** (`ednagrace.github.io`). A API está no repositório
separado **`ednagrace/relatorio-api`**.

## 📁 Arquivos

```
index.html            → app
styles.css            → visual
app.js                → lógica (login, formulário, listagem, PDF, sincronização)
manifest.webmanifest  → instalável na tela inicial
sw.js                 → offline
icons/                → ícones
```

---

## 🚀 Colocar em produção (uma vez)

### 1) API na Vercel (banco Neon)
Siga o `README.md` do repositório **`ednagrace/relatorio-api`**. Resumo:
1. https://vercel.com → entrar com GitHub → **Import** `ednagrace/relatorio-api`.
2. Colar as variáveis de ambiente (DATABASE_URL do Neon, GOOGLE_CLIENT_ID,
   ALLOWED_EMAILS, ALLOWED_ORIGIN, SESSION_SECRET, SESSION_DAYS).
3. **Deploy** → anotar a URL final (ex.: `https://relatorio-api.vercel.app`).

### 2) Autorizar o domínio no Google
No **Google Cloud Console → Credenciais → o OAuth Client ID**, em
**Authorized JavaScript origins**, adicionar:
```
https://ednagrace.github.io
```
(sem isso o botão de login do Google não aparece).

### 3) Apontar o app para a API
Em `app.js`, confirmar as constantes de topo `API_BASE` (URL da Vercel do passo 1) e
`GOOGLE_CLIENT_ID`. São **config fixa do site** (não segredos; iguais para todo navegador,
nada guardado no aparelho). Depois `git push` (o GitHub Pages publica sozinho).

> As **metas, promotora e loja** ficam no **Neon** (endpoint `/api/settings`), compartilhadas
> entre aparelhos/logins. Só `API_BASE` e `GOOGLE_CLIENT_ID` são constantes do site, porque
> são necessários **antes** do login (não dá para buscá-los no banco sem já estar logado).

### 4) Instalar no celular da Edna
1. Abrir **https://ednagrace.github.io/** no Chrome do Galaxy A15.
2. Login com a conta Google autorizada (só na 1ª vez).
3. Menu ⋮ → **Adicionar à tela inicial** → vira app com ícone.

---

## 📱 Uso no dia a dia

1. Abre o app (já logado) → vê a **lista do mês**, a **meta do mês** e a **meta do dia**.
2. **＋ Novo Relatório** → em cada item toca no número (0–15) ou usa **−/＋**.
3. **💾 Salvar** → vai para o Neon automaticamente (ou fica 🟠 e envia quando tiver net).
4. **📄 Gerar PDF** (no formulário ou no card) → compartilha no WhatsApp.

Metas: **mês** (padrão 22) e **dia** (padrão 3), editáveis no cartão vermelho.
Menu ⚙️: Sincronizar, Exportar CSV, Compartilhar resumo, Configurações, **Sair**.

## 🔒 Acesso

Emails autorizados (allowlist) — no front (`ALLOWLIST` em `app.js`) e no back
(`ALLOWED_EMAILS` na Vercel):

- `ednapromotora69@gmail.com`
- `edna.cristina.g69@gmail.com`
- `jpantunesdesouza@gmail.com`

> O GitHub Pages é público (os arquivos podem ser baixados), mas os **dados no Neon**
> só são acessíveis com uma sessão válida de um email da allowlist — o back-end confere.

## 🔧 Manutenção

- Atualizou o app? `git push` e suba a versão em `sw.js` (`v10` → `v11`).
- Campos do relatório: constante `GROUPS` em `app.js`.
- Adicionar/remover email: `ALLOWLIST` (app.js) **e** `ALLOWED_EMAILS` (Vercel).

## Campos do relatório

Propostas: Aprovadas · Reprovadas · Em Análise · Pendências
Links · Cartão (Entregas / A Receber — retirada do cartão na loja)
Serviços: SMS · Bônus · Fatura Digital · Odonto Plus
\+ Observações e Metas (mês/dia).
