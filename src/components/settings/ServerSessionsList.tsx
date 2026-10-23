// Appareils connectés à Pécule (sessions du serveur) : type d'appareil, dates, et
// « Déconnecter cet appareil » pour fermer une session qu'on ne reconnaît pas (par exemple
// après une alerte « retrait du verrou demandé » reçue sur un autre appareil).
import React, { useCallback, useEffect, useState } from 'react';
import { Laptop, Loader2, LogOut } from 'lucide-react';
import { listServerSessions, revokeServerSession, type ServerSession } from '../../services/backendService';
import { Button } from '../ui';
import { CardSubheading, Hint } from './SettingsCard';
import { useToast } from '../Toast';

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export const ServerSessionsList: React.FC<{
  confirm: (title: string, message: string, onOk: () => void | Promise<void>, danger?: boolean) => void;
  /** La session de CET appareil vient d'être fermée. */
  onSignedOut: () => void;
}> = ({ confirm, onSignedOut }) => {
  const toast = useToast();
  const [sessions, setSessions] = useState<ServerSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => {
    listServerSessions().then(s => { setSessions(s); setFailed(false); }).catch(() => { setSessions([]); setFailed(true); });
  }, []);
  useEffect(refresh, [refresh]);

  const disconnect = (s: ServerSession) => confirm(
    s.current ? 'Déconnecter cet appareil ?' : `Déconnecter « ${s.device ?? 'appareil inconnu'} » ?`,
    s.current
      ? 'Cet appareil sera déconnecté de Pécule et ne recevra plus de notifications. Il faudra vous reconnecter.'
      : 'Cet appareil ne pourra plus accéder à Pécule ni recevoir de notifications sans se reconnecter avec votre compte Google. Si vous ne le reconnaissez pas, changez aussi le mot de passe de votre compte Google.',
    async () => {
      try {
        await revokeServerSession(s.id);
        if (s.current) { onSignedOut(); return; }
        toast?.({ message: 'Appareil déconnecté', kind: 'success' });
      } catch { toast?.({ message: 'Serveur injoignable, réessayez.', kind: 'error' }); }
      refresh();
    }, true);

  return (
    <div className="pt-5 mt-5 border-t border-outline-variant">
      <CardSubheading icon={Laptop}>Appareils connectés</CardSubheading>
      <Hint className="mt-1">Chaque appareil où vous êtes connecté à Pécule. Vous n'en reconnaissez pas un ? Déconnectez-le.</Hint>
      {sessions === null ? <Loader2 className="w-4 h-4 animate-spin mt-3 text-on-surface-variant" aria-label="Chargement" />
        : failed ? <p className="text-sm text-on-surface-variant mt-2">Liste indisponible (serveur injoignable).</p>
        : (
          <ul className="mt-2 divide-y divide-outline-variant" aria-label="Appareils connectés">
            {sessions.map(s => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm text-on-surface">
                <span className="min-w-0">
                  <span className="font-medium">{s.device ?? 'Appareil inconnu'}</span>
                  {s.current && <span className="ml-1 font-medium text-primary">(cet appareil)</span>}
                  <span className="block text-xs text-on-surface-variant">
                    {s.createdAt ? `Connecté le ${day(s.createdAt)}` : 'Connecté'} · utilisé le {day(s.lastUsedAt)}
                  </span>
                  {/* Session ouverte avant la liaison à l'appareil (octobre 2026) : refusée par le
                      serveur, l'appareil devra se reconnecter. Sinon, session sans clé (navigateur
                      qui ne peut pas la garder) : utilisable sans l'appareil. */}
                  {s.legacy
                    ? <span className="block text-xs text-on-surface-variant">Ancienne connexion, plus acceptée : cet appareil devra se reconnecter. Vous pouvez la retirer.</span>
                    : !s.bound && <span className="block text-xs text-on-surface-variant">Connexion moins protégée (navigateur sans clé d'appareil) : déconnectez-la si vous ne la reconnaissez pas.</span>}
                </span>
                <Button variant="text" className="shrink-0 min-h-12 sm:min-h-10" onClick={() => disconnect(s)}
                  aria-label={s.current ? 'Déconnecter cet appareil' : `Déconnecter l'appareil ${s.device ?? 'inconnu'}`}>
                  <LogOut className="w-4 h-4" aria-hidden="true" /> Déconnecter
                </Button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
};
