import { apiUrl } from './env.js';
import { authHeaders } from './api.js';
import { toast } from './ui.js';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Converts the VAPID public key (base64url) into the Uint8Array applicationServerKey wants.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported()) {
    alert('Este aparelho/navegador não suporta notificações push.\n\nNo Android, abra o app pelo Chrome (ou instale-o na tela inicial).');
    return false;
  }
  try {
    // Notification.permission já diz se está BLOQUEADO — nesse caso o Chrome nunca
    // mostra o pedido de novo, e a promotora fica achando que "já autorizou".
    if (Notification.permission === 'denied') {
      alert(
        'As notificações estão BLOQUEADAS para este app.\n\n' +
        'O Android não pergunta de novo enquanto estiver bloqueado. Para liberar:\n\n' +
        '1. Segure o ícone do app → Informações do app → Notificações → ative.\n' +
        '   (ou Config. do Android → Apps → Relatórios Diários → Notificações)\n' +
        '2. Volte aqui e marque a opção de novo.'
      );
      return false;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Você não permitiu as notificações. Marque a opção de novo e toque em "Permitir" quando o Android perguntar.');
      return false;
    }

    let root: any;
    try {
      root = await (await fetch(apiUrl('/'), { cache: 'no-store' })).json();
    } catch (e) {
      alert('Sem conexão com o servidor agora. Tente ativar as notificações de novo com internet.');
      return false;
    }
    if (!root.pushPublicKey) {
      alert('As notificações push não estão configuradas no servidor (falta a chave VAPID). Avise o suporte.');
      return false;
    }

    const reg = await navigator.serviceWorker.ready;
    const appServerKey = urlBase64ToUint8Array(root.pushPublicKey) as BufferSource;

    // Se já existe uma inscrição feita com OUTRA chave (chave VAPID trocada, teste
    // antigo), o subscribe() abaixo estoura com InvalidStateError. Remove a velha e segue.
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      let sameKey = true;
      try {
        const a = new Uint8Array((existing.options.applicationServerKey as ArrayBuffer) || new ArrayBuffer(0)).join(',');
        const b = new Uint8Array(appServerKey as ArrayBuffer).join(',');
        sameKey = a === b;
      } catch (e) { sameKey = false; }
      if (!sameKey) await existing.unsubscribe().catch(() => {});
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });

    const res = await fetch(apiUrl('/api/push'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || ('servidor respondeu ' + res.status));
    toast('Notificações ativadas ✓', 'ok');
    return true;
  } catch (e: any) {
    console.error('[push] falha ao ativar', e);
    alert('Não consegui ativar as notificações.\n\nMotivo: ' + (e && e.message ? e.message : e) +
      '\n\nTire um print desta mensagem e mande no suporte.');
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const sub = await currentPushSubscription();
    if (!sub) return true;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch(apiUrl('/api/push?endpoint=' + encodeURIComponent(endpoint)), {
      method: 'DELETE', headers: authHeaders(),
    });
    toast('Notificações desativadas', 'ok');
    return true;
  } catch (e: any) {
    toast('Erro ao desativar notificações: ' + e.message, 'err');
    return false;
  }
}

/* ---------------- Ferramentas de teste (só admin) ---------------- */

// Manda uma notificação de teste AGORA para as inscrições deste email (as do
// próprio admin). Serve para provar, ponta a ponta, que o push funciona.
export async function sendTestPush(): Promise<void> {
  try {
    const res = await fetch(apiUrl('/api/push-cron?test=1'), { method: 'POST', headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || ('servidor respondeu ' + res.status));
    if (!data.subscriptions) {
      alert('O servidor não tem NENHUMA inscrição para o seu email.\n\n' +
        'Marque "Notificações de lembrete" primeiro (e confirme que deu certo), depois teste de novo.');
      return;
    }
    alert(`Enviado para ${data.sent}/${data.subscriptions} inscrição(ões) do seu email.\n\n` +
      'A notificação deve aparecer em alguns segundos. Se não aparecer, o problema é a entrega ' +
      '(chave VAPID privada / rede), não a inscrição.');
  } catch (e: any) {
    alert('Falha no teste: ' + (e && e.message ? e.message : e));
  }
}

// Roda a rotina diária de lembretes AGORA, ignorando a hora e os dias de trabalho
// (só admin). Útil para testar o "relatório de hoje pendente" fora das 18h.
export async function runRemindersNow(): Promise<void> {
  try {
    const res = await fetch(apiUrl('/api/push-cron?admin=1&force=1'), { method: 'POST', headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || ('servidor respondeu ' + res.status));
    alert('Rotina executada.\n\n' +
      `Clientes para retornar hoje: ${data.due}\n` +
      `Lembrete de relatório: ${data.relatorioLembrado ? 'sim' : 'não'}\n` +
      `Inscrições no total: ${data.subscriptions ?? '—'}\n` +
      `Notificações enviadas: ${data.sent}`);
  } catch (e: any) {
    alert('Falha ao rodar a rotina: ' + (e && e.message ? e.message : e));
  }
}
