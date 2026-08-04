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
  if (!pushSupported()) { toast('Este navegador não suporta notificações', 'err'); return false; }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { toast('Permissão de notificação negada', 'err'); return false; }

    const root = await (await fetch(apiUrl('/'), { cache: 'no-store' })).json();
    if (!root.pushPublicKey) { toast('Notificações push não configuradas no servidor', 'err'); return false; }

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(root.pushPublicKey) as BufferSource,
    });

    const res = await fetch(apiUrl('/api/push'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'falha ao registrar');
    toast('Notificações ativadas ✓', 'ok');
    return true;
  } catch (e: any) {
    toast('Erro ao ativar notificações: ' + e.message, 'err');
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
