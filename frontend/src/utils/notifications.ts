let swRegistration: ServiceWorkerRegistration | null = null;

const ICON_SVG =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><rect width='128' height='128' rx='28' fill='%23059669'/><path fill='%23ffffff' d='M98 32H30c-4.4 0-8 3.6-8 8v58l16-16h60c4.4 0 8-3.6 8-8V40c0-4.4-3.6-8-8-8z'/></svg>";

export async function registerAppServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    swRegistration = reg;
    return reg;
  } catch {
    return null;
  }
}

export function getNotificationPermissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestAppNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export function playSoftNotificationTone() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close().catch(() => {}), 300);
  } catch {}
}

export async function showAppNotification(options: {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  vibrate?: number[];
}) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const notifOptions: NotificationOptions & { vibrate?: number[] } = {
    body: options.body,
    icon: ICON_SVG,
    badge: ICON_SVG,
    tag: options.tag,
    data: options.data || {},
    requireInteraction: Boolean(options.requireInteraction),
    vibrate: options.vibrate || [180, 90, 180],
  };

  try {
    // Prefer ServiceWorkerRegistration.showNotification (required on Android Chrome!)
    const reg =
      swRegistration ||
      ("serviceWorker" in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null);

    if (reg && typeof reg.showNotification === "function") {
      await reg.showNotification(options.title, notifOptions);
      return;
    }
  } catch {
    // Fallback to desktop Notification constructor
  }

  try {
    const n = new Notification(options.title, notifOptions);
    n.onclick = () => {
      window.focus();
      n.close();
      if (options.data) {
        window.dispatchEvent(new CustomEvent("zust:notification-click", { detail: options.data }));
      }
    };
  } catch {
    // Ignore on restricted environments
  }
}
