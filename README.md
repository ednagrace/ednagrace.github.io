# Relatório Diário — Edna Grace / Savegnago

App de celular (PWA) para a promotora preencher o relatório diário de forma rápida:
botões de número (0–4, 5–9, 10–15) e botões **−/＋** para acertar a contagem de
propostas aprovadas, reprovadas, link, cartão, SMS, bônus etc.

Os relatórios são **enviados automaticamente para uma planilha do Google Sheets**,
onde o gerente acompanha tudo. Funciona **offline**: se estiver sem internet, o app
guarda no celular e envia sozinho quando a conexão voltar.

---

## 📁 O que tem aqui

```
index.html              → app (abre no celular)
styles.css              → visual
app.js                  → toda a lógica (formulário, listagem, sincronização)
manifest.webmanifest    → deixa instalável na tela inicial
sw.js                   → funcionamento offline
icons/                  → ícones do app
backend/Code.gs         → código que vai na planilha do Google (recebe os dados)
```

---

## 🚀 Passo a passo (uma vez só)

### Parte 1 — Criar a planilha que recebe os dados

1. Acesse **https://sheets.google.com** e crie uma planilha nova.
   Dê um nome, ex.: **Relatórios Edna — Savegnago**.
2. No menu, vá em **Extensões → Apps Script**.
3. Apague o conteúdo que aparecer e **cole todo o conteúdo de `backend/Code.gs`**.
4. (Opcional) Na linha `var TOKEN = 'edna-savegnago-2026';` você pode trocar por
   outra "senha". **Guarde esse valor** — vai usar no app.
5. Clique em **Implantar → Nova implantação**.
   - Tipo: **App da Web** (Web app).
   - Executar como: **Eu**.
   - Quem pode acessar: **Qualquer pessoa** (importante! senão o app não consegue enviar).
6. Clique em **Implantar**, autorize o acesso (é sua própria conta) e **copie a URL**
   que termina em `/exec`. Ex.:
   `https://script.google.com/macros/s/AKfy.../exec`
7. Guarde essa URL — é o **"Link do Web App"** que vai no app.

> A aba **Relatorios** é criada sozinha na primeira vez que um relatório é salvo.

### Parte 2 — Publicar o app (front-end)

O app é só HTML/JS estático. Escolha **uma** opção:

**Opção A — Netlify (mais fácil, grátis):**
1. Acesse **https://app.netlify.com/drop**
2. Arraste a **pasta EDNA inteira** para a página.
3. Ele te dá um link `https://algum-nome.netlify.app`. Pronto.

**Opção B — GitHub Pages:**
1. Suba a pasta para um repositório no GitHub.
2. Settings → Pages → Branch `main` / pasta `/root` → Save.
3. Use o link gerado.

> Precisa ser **https** (Netlify e GitHub Pages já são) para instalar como app e
> funcionar offline.

### Parte 3 — Configurar no celular da Edna (Galaxy A15)

1. Abra o link do app no **Chrome** do celular.
2. Toque no **⚙️ (canto superior direito) → Configurações**.
3. Cole o **Link do Web App** (o `/exec` da Parte 1) e a **senha/token**
   (o mesmo `TOKEN` do script).
4. Toque em **Testar conexão** → deve aparecer "✓ Conectado!".
5. Toque em **Salvar**.
6. Instale na tela inicial: menu do Chrome (⋮) → **Adicionar à tela inicial**.
   Agora tem o ícone do app no celular. 🎉

---

## 📱 Como a Edna usa no dia a dia

1. Toca no ícone do app → vê a **lista de relatórios do mês** e a **barra da meta**.
2. Toca em **＋ Novo Relatório**.
3. Em cada item (Aprovadas, Reprovadas, Link, SMS...), toca no **número** (0–15)
   ou usa **−/＋** para ajustar.
4. Toca em **💾 Salvar**. Pronto — vai para a planilha automaticamente.
   - Sem internet? Fica com a bolinha 🟠 e envia sozinho depois.
   - Enviado? Bolinha 🟢.

**A meta do mês** (padrão 22): toque em **editar** no cartão vermelho e digite.
O app soma sozinho as aprovadas do mês e mostra `12 / 22` com a barra de progresso.

**A meta do dia** (padrão 3): também no cartão vermelho, em *🎯 Meta do dia*.
No formulário, ao lançar as Aprovadas, aparece na hora se a meta do dia foi batida.
Na lista, os dias que bateram a meta ganham 🎯 verde.

**Gerar PDF para o WhatsApp:** botão **📄 Gerar PDF para WhatsApp** no fim do
formulário, ou o botãozinho 📄 em cada relatório da lista. Abre o menu de
compartilhar do Android — é só escolher o WhatsApp e enviar o arquivo.

**Compartilhar resumo em texto:** ⚙️ → *Compartilhar resumo do dia*.
**Baixar planilha do mês (CSV):** ⚙️ → *Exportar CSV (mês)*.

---

## 🔧 Manutenção

- **Mudou algo no app?** Suba os arquivos de novo (Netlify: arraste a pasta outra vez)
  e aumente a versão em `sw.js` (`edna-relatorio-v1` → `v2`) para o celular pegar a atualização.
- **Mudou o `Code.gs`?** No Apps Script: **Implantar → Gerenciar implantações → editar
  (lápis) → Nova versão → Implantar**. A URL `/exec` continua a mesma.
- **Campos do relatório** ficam em `app.js`, na constante `GROUPS` (fácil de mexer).

---

## Campos do relatório

Propostas: Aprovadas · Reprovadas · Em Análise · Pendências
Links · Cartão (Entregas / A Receber — retirada do cartão na loja)
Serviços: SMS · Bônus · Fatura Digital · Odonto Plus
\+ Observações e Meta do mês.
