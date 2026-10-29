// « Appareil » : état de ce navigateur, sans rapport avec le fichier Drive.
// - Stockage protégé (services/persistentStorage) : le navigateur peut-il effacer d'un coup les
//   copies locales (clé de chiffrement, saisies pas encore envoyées, verrou) faute de place ?
// - Journal des erreurs (lib/errorJournal) : les 20 dernières, nettoyées de toute donnée, à
//   copier pour signaler un problème.
import React, { useCallback, useEffect, useState } from 'react';
import { Copy, ShieldCheck, ShieldAlert, Trash2, Bug } from 'lucide-react';
import { Button } from '../ui';
import { CardSubheading, Hint, useCardSummary } from './SettingsCard';
import { getPersistState, requestPersist, type PersistState } from '../../services/persistentStorage';
import { clearErrorJournal, formatErrorJournal, readErrorJournal, type ErrorEntry } from '../../lib/errorJournal';

const PERSIST_TEXT: Record<PersistState, { label: string; detail: string }> = {
  granted: {
    label: 'Stockage protégé',
    detail: "Le navigateur ne l'effacera pas pour faire de la place : vos saisies pas encore envoyées sur Drive, la copie hors ligne et le verrou restent sur cet appareil.",
  },
  'not-granted': {
    label: 'Stockage non protégé',
    detail: "Sur un appareil presque plein, le navigateur peut effacer d'un coup ce que Pécule garde ici (saisies pas encore envoyées, copie hors ligne, verrou). Vos données sur Drive ne sont pas concernées. Le navigateur accorde la protection plus volontiers à une app installée et souvent ouverte.",
  },
  unsupported: {
    label: 'Protection non proposée',
    detail: "Ce navigateur ne permet pas de protéger le stockage de l'app. Vos données sur Drive ne sont pas concernées.",
  },
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const DeviceSection: React.FC = () => {
  const [persist, setPersist] = useState<PersistState | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    let alive = true;
    void getPersistState().then(s => { if (alive) setPersist(s); });
    return () => { alive = false; };
  }, []);
  const ask = async () => {
    setAsking(true);
    setPersist(await requestPersist());
    setAsking(false);
  };

  const [journal, setJournal] = useState<ErrorEntry[]>(readErrorJournal);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const refresh = useCallback(() => setJournal(readErrorJournal()), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatErrorJournal(journal));
      setCopyMsg('Journal copié.');
    } catch { setCopyMsg('Copie impossible sur ce navigateur.'); }
  };
  const clear = () => { clearErrorJournal(); setCopyMsg(null); refresh(); };

  useCardSummary('device', [
    persist ? PERSIST_TEXT[persist].label : null,
    journal.length === 0 ? 'aucune erreur notée' : `${journal.length} erreur${journal.length > 1 ? 's' : ''} notée${journal.length > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · '));

  const PersistIcon = persist === 'granted' ? ShieldCheck : ShieldAlert;
  return (
    <div className="space-y-6">
      <section aria-label="Stockage de cet appareil" className="space-y-2">
        <CardSubheading icon={PersistIcon}>{persist ? PERSIST_TEXT[persist].label : 'Stockage de cet appareil'}</CardSubheading>
        {persist && <Hint>{PERSIST_TEXT[persist].detail}</Hint>}
        {persist === 'not-granted' && (
          <Button variant="tonal" onClick={ask} disabled={asking}>
            <ShieldCheck className="w-4 h-4" aria-hidden="true" /> {asking ? 'Demande en cours…' : 'Demander la protection'}
          </Button>
        )}
      </section>

      <section aria-label="Journal des erreurs" className="pt-5 border-t border-outline-variant space-y-2">
        <CardSubheading icon={Bug}>Journal des erreurs</CardSubheading>
        <Hint>
          Les 20 dernières erreurs de Pécule sur cet appareil, pour aider à comprendre un problème. Rien n'est envoyé :
          le journal reste ici, sans montant, nom ni contenu de fichier. Copiez-le pour le joindre à un message.
        </Hint>
        {journal.length === 0 ? (
          <p className="text-sm text-on-surface-variant">Aucune erreur notée.</p>
        ) : (
          <>
            <ol className="space-y-2 max-h-72 overflow-y-auto" aria-label="Erreurs notées">
              {journal.map((e, i) => (
                <li key={`${e.at}-${i}`} className="rounded-xl bg-surface-container p-3 text-xs text-on-surface-variant">
                  <p className="tabular-nums">
                    {when(e.at)} · version {e.version} · {e.source}{e.count && e.count > 1 ? ` · ×${e.count}` : ''}
                  </p>
                  <p className="mt-1 text-sm text-on-surface break-words">{e.message}</p>
                  {e.where && <p className="mt-1 break-words">Où : {e.where}</p>}
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="tonal" onClick={copy}><Copy className="w-4 h-4" aria-hidden="true" /> Copier</Button>
              <Button variant="text" onClick={clear}><Trash2 className="w-4 h-4" aria-hidden="true" /> Effacer</Button>
            </div>
          </>
        )}
        {copyMsg && <p role="status" className="text-sm text-on-surface-variant">{copyMsg}</p>}
      </section>
    </div>
  );
};
