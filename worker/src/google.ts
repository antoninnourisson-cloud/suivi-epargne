// ================================================
// FILE: worker/src/google.ts
// Échanges avec Google : flux OAuth « Authorization Code » (le seul qui délivre un
// refresh token longue durée, d'où ce serveur) et lecture du fichier de données Drive
// pour la tâche quotidienne des notifications.
// ================================================

// Mêmes droits que l'app + identité (openid/email) pour savoir QUI se connecte.
// drive.file reste limité aux fichiers créés par l'app : le serveur ne voit rien d'autre
// sur le Drive. Le client OAuth doit être LE MÊME que celui de l'app, sinon drive.file ne
// donnerait pas accès au fichier existant.
export const OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

export class GoogleAuthError extends Error {
  // `invalid_grant` = refresh token révoqué ou expiré : il faut se reconnecter.
  constructor(public code: string, message: string) { super(message); this.name = 'GoogleAuthError'; }
}

const postToken = async (params: Record<string, string>): Promise<TokenResponse> => {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleAuthError(json.error || `HTTP_${res.status}`, json.error_description || 'Google token endpoint error');
  return json as TokenResponse;
};

export const exchangeCode = (code: string, clientId: string, clientSecret: string, redirectUri: string) =>
  postToken({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });

export const refreshAccessToken = (refreshToken: string, clientId: string, clientSecret: string) =>
  postToken({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' });

/**
 * Identité portée par l'id_token. Pas de vérification de signature : le jeton vient
 * DIRECTEMENT de l'endpoint de Google, en back-channel TLS authentifié par le secret
 * client — cas explicitement prévu par OpenID Connect Core §3.1.3.7.
 */
export interface IdTokenClaims {
  sub: string; email?: string; email_verified?: boolean; aud?: string | string[]; iss?: string; exp?: number; azp?: string;
}

export const decodeIdToken = (idToken: string): IdTokenClaims => {
  const payload = idToken.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4));
  return JSON.parse(decodeURIComponent(escape(json)));
};

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Même reçu en back-channel, on vérifie que le jeton est bien émis par Google POUR ce
 * client (OIDC Core §3.1.3.7, points 2-3) et qu'il n'est pas expiré.
 */
export const verifyIdTokenClaims = (claims: IdTokenClaims, clientId: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean => {
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) return false;
  if (!claims.iss || !GOOGLE_ISSUERS.includes(claims.iss)) return false;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return false;
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) return false;
  if (typeof claims.exp === 'number' && claims.exp + 300 < nowSeconds) return false;
  return true;
};

export const revokeToken = (token: string) =>
  fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);

const DATA_FILE_NAME = 'suivi_epargne.json';

/** Lit le fichier de données de l'utilisateur (même recherche que l'app). `null` si absent. */
export const readDataFile = async (accessToken: string): Promise<any | null> => {
  const q = encodeURIComponent(`name = '${DATA_FILE_NAME}' and trashed = false`);
  const list = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!list.ok) throw new Error(`DRIVE_LIST_${list.status}`);
  const files = ((await list.json()) as any).files || [];
  if (files.length === 0) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${files[0].id}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`DRIVE_READ_${res.status}`);
  return res.json();
};
