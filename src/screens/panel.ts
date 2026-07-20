import { ALL_FIELDS, MONTHS } from '../constants.js';
import { state } from '../state.js';
import { app, render } from '../render.js';
import { pad, parseISO } from '../dateUtils.js';
import { esc, fmtNA, byId } from '../format.js';
import { metaFor, monthTotals, weeklyBreakdown } from '../aggregations.js';
import { shareMonthPDF } from '../pdf.js';
import { shiftMonth } from './list.js';

export function openPanel() { state.view = 'panel'; render(); window.scrollTo(0, 0); }

// Donut chart in SVG (no library). segs = [{label, value, color}].
function donutSVG(segs: { label: string; value: number; color: string }[], total: number): string {
  const C = 2 * Math.PI * 45;
  const active = segs.filter(s => s.value > 0);
  const gap = total > 0 && active.length > 1 ? 3 : 0;
  let acc = 0, arcs = '';
  if (total <= 0) {
    arcs = '<circle cx="60" cy="60" r="45" fill="none" stroke="#e6e8ec" stroke-width="18"/>';
  } else {
    segs.forEach(s => {
      if (s.value <= 0) return;
      const segLen = (s.value / total) * C;
      const dash = Math.max(0.001, segLen - gap);
      arcs += `<circle cx="60" cy="60" r="45" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-acc}"/>`;
      acc += segLen;
    });
  }
  return `<svg class="donut" viewBox="0 0 120 120" width="118" height="118" role="img" aria-label="Gráfico de propostas">
    <g transform="rotate(-90 60 60)">${arcs}</g>
    <text x="60" y="57" text-anchor="middle" class="donut-num">${total}</text>
    <text x="60" y="73" text-anchor="middle" class="donut-lbl">propostas</text>
  </svg>`;
}

export function renderPanel() {
  const monthKey = state.month;
  const [y, m] = monthKey.split('-').map(Number);
  const t = monthTotals(monthKey);
  const meta = metaFor(monthKey);
  const feitas = (t.aprovadas as number) || 0;   // N/A conta como 0 na barra de meta
  const pct = meta > 0 ? Math.min(100, Math.round((feitas / meta) * 100)) : 0;
  const weeks = weeklyBreakdown(monthKey);
  const maxAp = Math.max(1, ...weeks.map(w => w.aprovadas));

  // Pie chart (donut) — proposals by status (validated colors). N/A counts as 0.
  const propSegs = [
    { label: 'Aprovadas', value: (t.aprovadas as number) || 0, color: '#0ca30c' },
    { label: 'Reprovadas', value: (t.reprovadas as number) || 0, color: '#d03b3b' },
    { label: 'Em Análise', value: (t.analise as number) || 0, color: '#c98500' },
    { label: 'Pendências', value: (t.pendencias as number) || 0, color: '#e0662f' },
  ];
  const propTotal = propSegs.reduce((s, x) => s + x.value, 0);
  const legend = propSegs.map(s => `
    <div class="lg-row">
      <span class="lg-dot" style="background:${s.color}"></span>
      <span class="lg-label">${s.label}</span>
      <span class="lg-val">${s.value}${propTotal ? ' · ' + Math.round((s.value / propTotal) * 100) + '%' : ''}</span>
    </div>`).join('');

  const tiles = ALL_FIELDS.map(f => `
    <div class="stat-tile">
      <div class="st-emoji">${f.emoji}</div>
      <div class="st-num">${fmtNA(t[f.key])}</div>
      <div class="st-label">${f.label}</div>
    </div>`).join('');

  const weeksHTML = weeks.length ? weeks.map(w => {
    const d = parseISO(w.week);
    const end = new Date(d); end.setDate(d.getDate() + 6);
    const label = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' – ' + pad(end.getDate()) + '/' + pad(end.getMonth() + 1);
    return `
      <div class="week-row">
        <div class="wk-head"><span>Semana ${label}</span><b>${w.aprovadas} aprov.</b></div>
        <div class="wk-bar"><i style="width:${Math.round((w.aprovadas / maxAp) * 100)}%"></i></div>
        <div class="wk-sub">${w.dias} dia(s) · ❌ ${w.reprovadas} reprov.</div>
      </div>`;
  }).join('') : '<div class="empty"><p>Sem relatórios neste mês.</p></div>';

  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
      <div style="flex:1">
        <h1>Painel do mês</h1>
        <span class="sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</span>
      </div>
      <button class="iconbtn" id="btn-share-month" aria-label="Compartilhar">📤</button>
    </header>

    <div class="screen">
      <div class="month-nav">
        <button id="prev-month" aria-label="Mês anterior">‹</button>
        <div class="label">${MONTHS[m-1]} ${y}</div>
        <button id="next-month" aria-label="Próximo mês">›</button>
      </div>

      <div class="meta-card">
        <div class="row"><span class="label">Meta do mês · aprovados</span></div>
        <div class="row" style="margin-top:4px">
          <div class="big">${feitas}<small> / ${meta || '—'}</small></div>
          <div style="text-align:right;font-size:22px;font-weight:800">${meta ? pct + '%' : ''}</div>
        </div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="hint">${t._dias} dia(s) com relatório no mês</div>
      </div>

      <h2 class="panel-h">Propostas do mês</h2>
      <div class="chart-card">
        ${donutSVG(propSegs, propTotal)}
        <div class="legend">${legend}</div>
      </div>

      <h2 class="panel-h">Totais do mês</h2>
      <div class="stat-grid">${tiles}</div>

      <h2 class="panel-h">Por semana</h2>
      <div class="weeks">${weeksHTML}</div>

      <button type="button" class="pdf-btn" id="btn-month-pdf">📄 PDF do resumo do mês</button>
      <button type="button" class="pdf-btn btn-wpp" id="btn-month-txt">💬 Enviar texto no WhatsApp</button>
    </div>`;

  byId('btn-back').onclick = () => { state.view = 'list'; render(); };
  byId('prev-month').onclick = () => shiftMonth(-1);
  byId('next-month').onclick = () => shiftMonth(1);
  byId('btn-month-pdf').onclick = () => shareMonthPDF(monthKey);
  byId('btn-month-txt').onclick = byId('btn-share-month').onclick = () => shareMonth(monthKey);
}

export function shareMonth(monthKey: string) {
  const [y, m] = monthKey.split('-').map(Number);
  const t = monthTotals(monthKey);
  const meta = metaFor(monthKey);
  const weeks = weeklyBreakdown(monthKey);
  let txt = `📊 *Resumo do mês — ${MONTHS[m-1]} ${y}*\n`;
  txt += `🏪 ${state.config.loja} · 👤 ${state.config.promotora}\n`;
  txt += `📅 ${t._dias} dia(s) com relatório\n\n`;
  txt += `*Propostas*\n✅ Aprovadas: ${t.aprovadas}\n❌ Reprovadas: ${t.reprovadas}\n🔍 Em análise: ${t.analise}\n⏳ Pendências: ${t.pendencias}\n\n`;
  txt += `🔗 Links: ${t.link}\n💳 Cartão — 📦 ${t.cartaoEntregas} entregas · 🕓 ${t.cartaoReceber} a receber\n\n`;
  txt += `*Serviços*\n💬 SMS: ${t.sms}\n🎁 Bônus: ${t.bonus}\n📄 Fatura Digital: ${t.faturaDigital}\n🦷 Odonto Plus: ${t.odontoPlus}\n`;
  if (meta) txt += `\n🎯 Meta: ${t.aprovadas}/${meta} aprovados (${Math.round(((t.aprovadas as number) / meta) * 100)}%)\n`;
  if (weeks.length) {
    txt += `\n*Aprovadas por semana*\n`;
    weeks.forEach(w => { const d = parseISO(w.week); txt += `• Semana ${pad(d.getDate())}/${pad(d.getMonth() + 1)}: ${w.aprovadas}\n`; });
  }
  if ((navigator as any).share) (navigator as any).share({ title: 'Resumo do mês', text: txt }).catch(() => {});
  else window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
}
