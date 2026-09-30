// ================================================
// FILE: src/services/installPrompt.ts
// Invitation à installer l'app sur le téléphone. Chrome (Android) émet
// `beforeinstallprompt` très tôt, souvent avant l'affichage du Tableau de bord : on le
// capte dès le chargement du module pour pouvoir proposer un vrai bouton « Installer ».
// ================================================

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // on affiche notre propre invitation, au bon moment
    deferred = e as InstallEvent;
    listeners.forEach(l => l());
  });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach(l => l()); });
}

export const canPromptInstall = () => deferred !== null;
export const onInstallAvailabilityChange = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export const promptInstall = async (): Promise<boolean> => {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice;
  listeners.forEach(l => l());
  return choice.outcome === 'accepted';
};

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export const mobilePlatform = (): 'ios' | 'android' | null => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
};
