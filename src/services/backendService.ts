// ================================================
// FILE: src/services/backendService.ts
// Dialogue avec le Worker (worker/) : session Google persistante et notifications push.
//
// Activé uniquement si VITE_BACKEND_URL est défini au build. Sans lui, l'app reste en mode
// « zéro serveur » (Google Identity Services dans le navigateur), exactement comme avant :
// le déploiement de l'app et celui du Worker sont donc indépendants.
//
// La session est un jeton opaque stocké localement. Il ne donne accès à AUCUNE donnée par
// lui-même : il permet seulement de demander au Worker un jeton d'accès Google court (1 h),
// que l'app utilise ensuite directement auprès de Drive et Gmail.
// ================================================

export const BACKEND_URL: string = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/+$/, '');
export const isBackendEnabled = (): boolean => BACKEND_URL !== '';

const SESSION_KEY = 'backend_session';

export const getSessionToken = (): string | null => {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
};
export const hasBackendSession = (): boolean => !!getSessionToken();
export const clearBackendSession = (): void => {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* stockage indisponible */ }
};

export interface AccessTokenResponse { access_token: string; expires_in: number }

const call = async (path: string, init: RequestInit = {}, withSession = true): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const token = withSession ? getSessionToken() : null;
  try {
    return await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch (e: any) {
    // Même convention que googleDriveService : un problème réseau (y compris un délai
    // dépassé) remonte en TypeError, ce que la sauvegarde traite comme « hors ligne ».
    if (e?.name === 'AbortError') throw new TypeError('BACKEND_TIMEOUT');
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

/** Redirige vers la connexion Google via le Worker ; l'app est rechargée au retour. */
export const startBackendLogin = (): void => {
  const returnUrl = window.location.origin + window.location.pathname;
  window.location.assign(`${BACKEND_URL}/auth/start?return=${encodeURIComponent(returnUrl)}`);
};

/**
 * Au retour de Google, le Worker renvoie vers l'app avec `#login_code=…` : un code à
 * usage unique (2 min), dans le fragment pour ne jamais être envoyé à un serveur. On
 * l'efface de l'URL AVANT l'échange, puis on l'échange contre la session.
 */
export const consumeLoginCode = async (): Promise<(AccessTokenResponse & { session: string }) | null> => {
  const match = /[#&]login_code=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (!match) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const res = await call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code: match[1] }) }, false);
  if (!res.ok) throw new Error('LOGIN_CODE_INVALID');
  const data = await res.json();
  // La session n'est PAS enregistrée ici : l'appelant range d'abord le jeton d'accès, puis
  // la session (saveBackendSession). Dans l'ordre inverse, un code s'exécutant entre les
  // deux voyait « une session mais pas de jeton » et lançait un rafraîchissement superflu.
  return { session: data.session, access_token: data.access_token, expires_in: data.expires_in };
};

export const saveBackendSession = (token: string): void => {
  localStorage.setItem(SESSION_KEY, token);
};

/** Jeton d'accès Google frais. `SESSION_EXPIRED` si le Worker exige une reconnexion. */
export const fetchAccessToken = async (): Promise<AccessTokenResponse> => {
  if (!hasBackendSession()) throw new Error('SESSION_EXPIRED');
  const res = await call('/token', { method: 'POST' });
  if (res.status === 401) {
    clearBackendSession();
    throw new Error('SESSION_EXPIRED');
  }
  if (!res.ok) throw new TypeError(`BACKEND_${res.status}`);
  return res.json();
};

export const backendLogout = async (): Promise<void> => {
  try { await call('/auth/logout', { method: 'POST' }); } catch { /* hors ligne : la session locale est effacée quand même */ }
  clearBackendSession();
};

// --- Notifications push ---

export const getVapidPublicKey = async (): Promise<string> => {
  const res = await call('/push/vapid-public-key', {}, false);
  if (!res.ok) throw new Error('VAPID_KEY_UNAVAILABLE');
  return (await res.json()).key;
};

export const registerPushSubscription = async (subscription: PushSubscriptionJSON): Promise<void> => {
  const res = await call('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
  if (res.status === 401) throw new Error('SESSION_EXPIRED');
  if (!res.ok) throw new Error('SUBSCRIBE_FAILED');
};

export const unregisterPushSubscription = async (endpoint: string): Promise<void> => {
  await call('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
};

export const sendTestPush = async (): Promise<boolean> => {
  const res = await call('/push/test', { method: 'POST' });
  if (!res.ok) return false;
  return !!(await res.json()).ok;
};
