// @vitest-environment jsdom
// Réinitialisation du verrou : la connexion demande le choix du compte, et « plus aucune
// session sur cet appareil » se vérifie après la déconnexion.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { backendLoginUrl } from './backendService';
import { handleAuthClick, hasStoredSession } from './googleDriveService';

// Connexion sans serveur (Google Identity Services) pour la partie GIS ci-dessous.
vi.mock('./backendService', async importOriginal => ({
  ...(await importOriginal<typeof import('./backendService')>()),
  isBackendEnabled: () => false,
}));

beforeEach(() => { localStorage.clear(); });

describe('connexion avec choix du compte', () => {
  it('ajoute select=1 seulement quand on le demande', () => {
    const plain = backendLoginUrl('https://pecule-app.com/');
    expect(plain).toMatch(/\/auth\/start\?return=https%3A%2F%2Fpecule-app\.com%2F$/);
    expect(backendLoginUrl('https://pecule-app.com/', { chooseAccount: true })).toBe(`${plain}&select=1`);
    expect(backendLoginUrl('https://pecule-app.com/', { chooseAccount: false })).toBe(plain);
  });

  it('sans serveur : GIS demande le choix du compte et l’accord seulement pour « Code oublié »', async () => {
    // Faux Google Identity Services : le script « se charge » aussitôt, et chaque demande de
    // jeton répond tout de suite en notant le `prompt` reçu.
    const prompts: string[] = [];
    const client = {
      callback: (_resp: unknown) => undefined as void,
      requestAccessToken: ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        client.callback({ access_token: 'ya29.test', expires_in: 3600 });
      },
    };
    const initTokenClient = vi.fn(() => client);
    (window as unknown as { google: unknown }).google = { accounts: { oauth2: { initTokenClient, revoke: vi.fn() } } };
    try {
      const first = handleAuthClick(false, { chooseAccount: true });
      // Le script GIS est inséré à la demande : on signale son chargement (jsdom ne le charge pas).
      const script = await vi.waitFor(() => {
        const el = document.head.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
        if (!el) throw new Error('script GIS pas encore inséré');
        return el;
      });
      script.dispatchEvent(new Event('load'));
      await first;
      await handleAuthClick(false);
      await handleAuthClick(false, { chooseAccount: false });
      await handleAuthClick(true, { chooseAccount: true }); // silencieux : jamais d'écran Google
      expect(prompts).toEqual(['select_account consent', '', '', 'none']);
      expect(initTokenClient).toHaveBeenCalledTimes(1);
      expect(hasStoredSession()).toBe(true);
    } finally {
      delete (window as unknown as { google?: unknown }).google;
    }
  });
});

describe('hasStoredSession', () => {
  it('vrai tant qu’un jeton Google est gardé sur l’appareil', () => {
    expect(hasStoredSession()).toBe(false);
    localStorage.setItem('google_token', '{"access_token":"x"}');
    expect(hasStoredSession()).toBe(true);
    localStorage.removeItem('google_token');
    expect(hasStoredSession()).toBe(false);
  });
});
