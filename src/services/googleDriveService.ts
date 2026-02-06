import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@capacitor-community/google-sign-in';

// Ton Client ID Web (Reste le même, même pour Android !)
const CLIENT_ID = '763862877733-hl1an9vcn0ibnoq2iq035927528mimd5.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send';
const FILE_NAME = 'suivi_epargne.json';

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

// --- INITIALISATION ---
export const initGoogleApi = async (): Promise<void> => {
  // 1. Mobile Natif
  if (Capacitor.isNativePlatform()) {
    try {
      await GoogleAuth.initialize({
        clientId: CLIENT_ID,
        scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/gmail.send'],
        grantOfflineAccess: false,
      });
      console.log('GoogleAuth Native initialized');
    } catch (e) {
      console.error('Erreur init GoogleAuth Native', e);
    }
    return;
  }

  // 2. Web Classique
  return new Promise((resolve) => {
    const loadGapi = () => {
        (window as any).gapi.load('client', async () => {
            await (window as any).gapi.client.init({
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
            });
            gapiInited = true;
            check();
        });
    };
    const loadGis = () => {
        tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '',
        });
        gisInited = true;
        check();
    };
    const check = () => { if (gapiInited && gisInited) resolve(); };
    
    if ((window as any).gapi) loadGapi();
    if ((window as any).google) loadGis();
  });
};

// --- VÉRIFICATION TOKEN ---
export const isTokenValid = (): boolean => {
  if (Capacitor.isNativePlatform()) {
    // En natif, on considère que le plugin gère la session
    return !!localStorage.getItem('google_token');
  }
  const expiry = localStorage.getItem('token_expiry');
  return expiry ? parseInt(expiry) > Date.now() : false;
};

// --- CONNEXION ---
export const handleAuthClick = async (silent: boolean = false): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    try {
      const user = await GoogleAuth.signIn();
      // On stocke le token d'accès pour les appels API fetch
      const tokenData = { access_token: user.authentication.accessToken };
      localStorage.setItem('google_token', JSON.stringify(tokenData));
      localStorage.setItem('auth_persistence', 'true');
    } catch (error) {
      console.error("Erreur Auth Native", error);
      throw error;
    }
    return;
  }

  // Web Fallback
  return new Promise((resolve, reject) => {
    tokenClient.callback = async (resp: any) => {
      if (resp.error) { reject(resp); return; }
      localStorage.setItem('google_token', JSON.stringify(resp));
      localStorage.setItem('token_expiry', (Date.now() + 3500 * 1000).toString());
      localStorage.setItem('auth_persistence', 'true');
      resolve();
    };
    if (silent) tokenClient.requestAccessToken({ prompt: 'none' });
    else tokenClient.requestAccessToken({ prompt: 'consent' });
  });
};

// --- DÉCONNEXION ---
export const handleSignOut = async () => {
  localStorage.removeItem('google_token');
  localStorage.removeItem('token_expiry');
  localStorage.removeItem('auth_persistence');
  
  if (Capacitor.isNativePlatform()) {
    await GoogleAuth.signOut();
  } else {
    const token = (window as any).gapi.client.getToken();
    if (token) {
      (window as any).google.accounts.oauth2.revoke(token.access_token);
      (window as any).gapi.client.setToken('');
    }
  }
};

// --- HELPERS API (FETCH) ---
const getAccessToken = async (): Promise<string> => {
    // TODO: En natif, implémenter ici un refresh automatique via GoogleAuth.refresh() si besoin
    const stored = localStorage.getItem('google_token');
    if (!stored) throw new Error("No token found");
    return JSON.parse(stored).access_token;
};

const apiRequest = async (url: string, options: RequestInit = {}) => {
    const token = await getAccessToken();
    const headers = { ...options.headers, Authorization: `Bearer ${token}` };
    const res = await fetch(url, { ...options, headers });
    return await res.json();
};

export const findConfigFile = async (): Promise<string | null> => {
  try {
      const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
      const data = await apiRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      return (data.files && data.files.length > 0) ? data.files[0].id : null;
  } catch (e) { return null; }
};

export const readConfigFile = async (fileId: string): Promise<any> => {
  const token = await getAccessToken(); // Appel direct pour le param alt=media
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
  });
  return await res.json();
};

export const createConfigFile = async (data: any): Promise<string> => {
  const token = await getAccessToken();
  const metadata = { name: FILE_NAME, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const result = await res.json();
  return result.id;
};

export const updateConfigFile = async (fileId: string, data: any): Promise<void> => {
  const token = await getAccessToken();
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
};

export const sendGmail = async (to: string, subject: string, body: string): Promise<void> => {
  try {
      const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
      const message = [`To: ${to}`, "Content-Type: text/html; charset=utf-8", "MIME-Version: 1.0", `Subject: ${utf8Subject}`, "", body].join("\n");
      const raw = btoa(unescape(encodeURIComponent(message))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      
      await apiRequest('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw })
      });
      console.log("Mail envoyé");
  } catch (e) { console.error("Erreur mail", e); }
};