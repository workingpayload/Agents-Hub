import { del, post } from './api';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return undefined;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('message', (e) => {
      const data = e.data as { type?: string; url?: string };
      if (data?.type === 'navigate' && data.url) window.dispatchEvent(new CustomEvent('agent-hub:navigate', { detail: data.url }));
    });
    return reg;
  } catch {
    return undefined;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(vapidPublicKey: string): Promise<void> {
  if (!pushSupported()) throw new Error('Push notifications need HTTPS with a trusted certificate (install the hub CA).');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!reg) throw new Error('Service worker could not be registered');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
  }
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (sub) {
    await del('/api/push/subscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
}
