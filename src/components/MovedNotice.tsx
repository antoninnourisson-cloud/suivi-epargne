// Déménagement vers pecule-app.com. Une app installée depuis l'ancienne adresse (github.io)
// continue de tourner depuis son cache, même une fois que GitHub redirige vers le nouveau
// domaine : son service worker ne peut plus se mettre à jour. Cet écran la détecte, coupe
// ses notifications (sinon elles arriveraient en double), vide l'ancienne origine et renvoie
// vers la nouvelle adresse.
import React, { useEffect, useState } from 'react';
import { Sprout, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './ui';
import { disablePush } from '../services/pushService';
import { storageKey } from '../lib/storageKeys';

const NEW_APP_URL = 'https://pecule-app.com/';
const OLD_HOST_SUFFIX = '.github.io';
const PENDING_KEY = storageKey('pending');

/** `true` quand l'ancienne adresse redirige déjà vers le nouveau domaine. */
const oldAddressRedirects = async (): Promise<boolean> => {
  try {
    const res = await fetch(`./?demenagement=${Date.now()}`, { redirect: 'manual', cache: 'no-store' });
    return res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
  } catch { return false; }
};

const hasUnsavedChanges = () => { try { return !!localStorage.getItem(PENDING_KEY); } catch { return false; } };

const leaveOldAddress = async () => {
  await disablePush().catch(() => undefined);
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    await Promise.all(regs.map(r => r.unregister()));
  } catch { /* rien à désinscrire */ }
  try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch { /* idem */ }
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage bloqué */ }
  try { indexedDB.deleteDatabase('pecule-vault'); } catch { /* idem */ }
  // Clé de la session serveur de cet appareil (backendService) : la session vient de partir avec localStorage.
  try { indexedDB.deleteDatabase('pecule-device-key'); } catch { /* idem */ }
  window.location.replace(NEW_APP_URL);
};

export const MovedNotice: React.FC = () => {
  const [moved, setMoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unsaved, setUnsaved] = useState(false);

  useEffect(() => {
    if (!window.location.hostname.endsWith(OLD_HOST_SUFFIX)) return;
    let alive = true;
    void oldAddressRedirects().then(r => { if (alive && r) { setMoved(true); setUnsaved(hasUnsavedChanges()); } });
    return () => { alive = false; };
  }, []);

  // Tant que des modifications attendent d'être écrites sur Drive, on revérifie : la
  // synchronisation continue de fonctionner ici pendant la transition.
  useEffect(() => {
    if (!moved || !unsaved) return;
    const t = window.setInterval(() => setUnsaved(hasUnsavedChanges()), 2000);
    return () => window.clearInterval(t);
  }, [moved, unsaved]);

  const go = async () => { setBusy(true); await leaveOldAddress(); };

  return (
    <Modal open={moved} onClose={() => undefined} label="Pécule a déménagé" className="max-w-md p-6">
      <h2 className="text-[22px] leading-7 font-normal text-on-surface flex items-center gap-2">
        <Sprout className="w-5 h-5 text-primary" aria-hidden="true" /> Pécule a déménagé
      </h2>
      <p className="text-sm text-on-surface-variant mt-3">
        L'app a maintenant sa propre adresse : <b>pecule-app.com</b>. Vos données ne bougent pas : elles restent sur votre Google Drive.
      </p>
      <ul className="list-disc pl-5 mt-3 space-y-1 text-sm text-on-surface-variant">
        <li>Reconnectez-vous avec le même compte Google.</li>
        <li>Sur chaque appareil, réactivez les notifications, le verrou et la clé Gemini (Paramètres).</li>
        <li>Sur téléphone, installez l'app depuis la nouvelle adresse, puis supprimez l'ancienne icône.</li>
      </ul>
      {unsaved && (
        <p role="status" className="mt-3 text-sm font-medium text-tertiary">
          Des modifications sont encore en cours d'envoi vers Drive : patientez quelques secondes avant de continuer.
        </p>
      )}
      <Button variant="filled" onClick={go} disabled={busy || unsaved} className="w-full mt-5">
        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
        Continuer sur pecule-app.com
      </Button>
    </Modal>
  );
};
