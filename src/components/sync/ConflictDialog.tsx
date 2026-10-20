// Choix entre deux versions des données : modifiées sur cet appareil ET ailleurs (conflit),
// ou deux fichiers de données sur Drive (doublon). Les deux versions sont montrées côte à
// côte (date, appareil, montants, principales différences) ; le choix se confirme, et la
// version écartée est mise de côté 30 jours (voir services/setAsideVersions).
//
// Aucun calcul ici : la comparaison vient de lib/versionDiff, le choix de usePortfolioData.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, Smartphone, Cloud } from 'lucide-react';
import { Modal } from '../Modal';
import { Button } from '../ui';
import { Notice } from '../settings/SettingsCard';
import { diffVersions, diffHighlights, summarizeVersion } from '../../lib/versionDiff';
import { formatEUR } from '../../lib/format';
import { downloadJSON } from '../../services/fileDownload';
import type { ConflictChoice, ConflictResolution, ConflictVersion, SyncConflictView } from '../../hooks/usePortfolioData';

const WORDING = {
  conflict: {
    title: 'Vos données ont changé sur un autre appareil',
    intro: 'Des modifications ont été faites ici et sur un autre appareil (ou un autre onglet). Pécule n\'a rien écrasé. Comparez les deux versions, puis choisissez celle à garder.',
    local: 'Cet appareil', remote: 'Drive',
    sides: { local: 'sur cet appareil', remote: 'sur Drive' },
    keep: { local: 'Garder la version de cet appareil', remote: 'Garder la version de Drive' },
    replaced: { local: 'La version de Drive sera remplacée par celle de cet appareil.', remote: 'Les modifications de cet appareil seront remplacées par la version de Drive.' },
  },
  duplicate: {
    title: 'Deux fichiers de données sur votre Drive',
    intro: 'Pécule a ouvert le plus récent. Comparez-le à l\'autre fichier ; rien n\'est modifié tant que vous n\'avez pas choisi.',
    local: 'Fichier ouvert', remote: 'Autre fichier',
    sides: { local: 'dans le fichier ouvert', remote: 'dans l\'autre fichier' },
    keep: { local: 'Garder le fichier ouvert', remote: 'Prendre l\'autre fichier' },
    replaced: { local: 'L\'autre fichier n\'est pas modifié ; il ne vous sera plus signalé.', remote: 'Le contenu du fichier ouvert sera remplacé par celui de l\'autre fichier.' },
  },
} as const;

const dateTime = (iso: string | null) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return 'date inconnue';
  return new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
};
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const VersionCard: React.FC<{
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  version: ConflictVersion | null;
  status: 'loading' | 'ready' | 'error';
  summary: { totalSavings: number; ownShare: number; accountCount: number; movementCount: number } | null;
  thisDeviceLabel: boolean;
  onRetry?: () => void;
  exportName: string;
}> = ({ title, icon: Icon, version, status, summary, thisDeviceLabel, onRetry, exportName }) => (
  <section aria-label={title} className="rounded-2xl bg-surface-container p-4 flex flex-col gap-3 min-w-0">
    <h3 className="text-base font-medium text-on-surface flex items-center gap-2"><Icon className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> {title}</h3>
    {status === 'loading' && <p className="text-sm text-on-surface-variant flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Lecture de cette version…</p>}
    {status === 'error' && (
      <div className="flex flex-col gap-2 items-start">
        <p className="text-sm text-on-surface-variant">Impossible de relire cette version pour le moment. Rien n'a été modifié.</p>
        {onRetry && <Button variant="outlined" onClick={onRetry}>Réessayer</Button>}
      </div>
    )}
    {status === 'ready' && version && summary && (
      <>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-on-surface-variant">Enregistrée</dt>
          <dd className="text-on-surface first-letter:uppercase">{dateTime(version.savedAt)}</dd>
          <dt className="text-on-surface-variant">Appareil</dt>
          <dd className="text-on-surface">{thisDeviceLabel ? `cet appareil${version.device ? ` (${version.device})` : ''}` : version.fromThisDevice ? 'cet appareil, dans un autre onglet' : version.device ?? 'inconnu'}</dd>
          <dt className="text-on-surface-variant">Épargne totale</dt>
          <dd className="text-on-surface font-medium tabular-nums">{formatEUR(summary.totalSavings)}</dd>
          <dt className="text-on-surface-variant">Votre part</dt>
          <dd className="text-on-surface tabular-nums">{formatEUR(summary.ownShare)}</dd>
          <dt className="text-on-surface-variant">Contenu</dt>
          <dd className="text-on-surface">{plural(summary.accountCount, 'compte', 'comptes')}, {plural(summary.movementCount, 'mouvement', 'mouvements')}</dd>
        </dl>
        <Button variant="text" className="self-start -ml-3 h-8 px-3" onClick={() => downloadJSON(exportName, version.data)}>
          <Download className="w-4 h-4" aria-hidden="true" /> Exporter cette version
        </Button>
      </>
    )}
  </section>
);

export const ConflictDialog: React.FC<{
  open: boolean;
  conflict: SyncConflictView;
  onClose: () => void;
  onResolve: (choice: ConflictChoice, opts?: { withoutCopy?: boolean }) => Promise<ConflictResolution>;
  onRetry: () => void;
  /** Appelé une fois le choix appliqué (message de confirmation). */
  onResolved: (choice: ConflictChoice, kind: SyncConflictView['kind']) => void;
}> = ({ open, conflict, onClose, onResolve, onRetry, onResolved }) => {
  const w = WORDING[conflict.kind];
  const [choice, setChoice] = useState<ConflictChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'copy-failed' | 'unavailable' | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  // Nouvelle comparaison (autre conflit, ou fenêtre rouverte) : on repart du choix.
  useEffect(() => { if (open) { setChoice(null); setError(null); } }, [open, conflict.kind]);
  // Étape de confirmation : le focus la suit (le bouton cliqué vient de disparaître).
  useEffect(() => { if (choice) confirmRef.current?.focus(); }, [choice]);

  const diff = useMemo(() => (conflict.remote ? diffVersions(conflict.local.data, conflict.remote.data) : null), [conflict.local.data, conflict.remote]);
  const localSummary = useMemo(() => diff?.local ?? summarizeVersion(conflict.local.data), [diff, conflict.local.data]);
  const highlights = useMemo(() => (diff ? diffHighlights(diff, w.sides, 6) : null), [diff, w.sides]);
  const ready = conflict.remoteStatus === 'ready' && !!conflict.remote;
  const localBlocked = conflict.kind === 'conflict' && conflict.remoteFromNewerApp;
  const day = new Date().toISOString().slice(0, 10);
  const exportNames = {
    local: `pecule-${conflict.kind === 'conflict' ? 'cet-appareil' : 'fichier-ouvert'}-${day}.json`,
    remote: `pecule-${conflict.kind === 'conflict' ? 'drive' : 'autre-fichier'}-${day}.json`,
  };
  // Étape de confirmation : la version qui sera mise de côté (rien ne l'est quand on garde le
  // fichier ouvert face à un doublon), exportable sans revenir en arrière.
  const replacesSomething = !!choice && !(conflict.kind === 'duplicate' && choice === 'local');
  const setAside = choice === 'local'
    ? (conflict.remote ? { name: exportNames.remote, data: conflict.remote.data } : null)
    : choice === 'remote' ? { name: exportNames.local, data: conflict.local.data } : null;

  const confirm = async (withoutCopy = false) => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onResolve(choice, { withoutCopy });
      if (result === 'done') onResolved(choice, conflict.kind);
      else setError(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} label={w.title} variant="sheet" className="max-w-3xl p-6">
      <h2 className="text-2xl text-on-surface mb-2 max-sm:mt-3 flex items-start gap-2">
        <AlertTriangle className="w-6 h-6 mt-0.5 shrink-0 text-tertiary" aria-hidden="true" /> {w.title}
      </h2>
      <p className="text-sm text-on-surface-variant mb-4">{w.intro}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <VersionCard title={w.local} icon={Smartphone} version={conflict.local} status="ready" summary={localSummary}
          thisDeviceLabel={conflict.kind === 'conflict'} exportName={exportNames.local} />
        <VersionCard title={w.remote} icon={Cloud} version={conflict.remote} status={conflict.remoteStatus} summary={diff?.remote ?? null}
          thisDeviceLabel={false} onRetry={onRetry} exportName={exportNames.remote} />
      </div>
      {conflict.remoteStatus === 'loading' && !diff && (
        <p className="sr-only" role="status">Lecture de l'autre version en cours.</p>
      )}

      {highlights && (
        <section aria-label="Principales différences" className="mt-4">
          <h3 className="text-sm font-medium text-on-surface mb-1">Principales différences</h3>
          {highlights.lines.length === 0
            ? <p className="text-sm text-on-surface-variant">Aucune différence dans vos comptes et réglages : les deux versions se valent.</p>
            : (
              <ul className="list-disc pl-5 text-sm text-on-surface-variant space-y-0.5">
                {highlights.lines.map(l => <li key={l}>{l}</li>)}
                {highlights.more > 0 && <li>et {plural(highlights.more, 'autre différence', 'autres différences')}</li>}
              </ul>
            )}
        </section>
      )}

      {localBlocked && (
        <Notice tone="warning" icon={AlertTriangle} className="mt-4">
          La version de Drive a été enregistrée par une version plus récente de Pécule : mettez l'app à jour avant de pouvoir la remplacer. Vous pouvez déjà la garder.
        </Notice>
      )}

      <div aria-live="assertive" className="mt-4 empty:hidden">
        {error === 'copy-failed' && (
          <Notice tone="error" icon={AlertTriangle}>
            Impossible de mettre l'autre version de côté sur cet appareil (stockage plein ou bloqué) : rien n'a été changé. Exportez-la d'abord avec « Exporter l'autre version », puis continuez sans copie.
          </Notice>
        )}
        {error === 'unavailable' && (
          <Notice tone="error" icon={AlertTriangle}>
            Les versions ont changé entre-temps : rien n'a été appliqué. Comparez à nouveau avant de choisir.
          </Notice>
        )}
      </div>

      {!choice ? (
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="text" onClick={onClose}>{conflict.kind === 'conflict' ? 'Décider plus tard' : 'Fermer'}</Button>
          <Button variant="tonal" disabled={!ready || localBlocked} onClick={() => setChoice('local')}>{w.keep.local}</Button>
          <Button variant="tonal" disabled={!ready} onClick={() => setChoice('remote')}>{w.keep.remote}</Button>
        </div>
      ) : (
        <div ref={confirmRef} tabIndex={-1} aria-label="Confirmer votre choix" className="mt-5 rounded-2xl border border-outline-variant p-4 outline-hidden">
          <p className="text-sm text-on-surface font-medium">{w.keep[choice]} ?</p>
          <p className="text-sm text-on-surface-variant mt-1">
            {w.replaced[choice]}{replacesSomething && ' L\'autre version reste récupérable 30 jours sur cet appareil, jusqu\'à votre déconnexion : Paramètres, Sauvegardes, « Versions mises de côté ». Pour la garder plus longtemps, exportez-la.'}
          </p>
          {replacesSomething && setAside && (
            <Button variant="text" className="mt-1 -ml-3 h-8 px-3" disabled={busy} onClick={() => downloadJSON(setAside.name, setAside.data)}>
              <Download className="w-4 h-4" aria-hidden="true" /> Exporter l'autre version
            </Button>
          )}
          <div className="mt-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button variant="text" disabled={busy} onClick={() => { setChoice(null); setError(null); }}>Retour</Button>
            {error === 'copy-failed' && <Button variant="danger" disabled={busy} onClick={() => void confirm(true)}>Continuer sans copie</Button>}
            <Button variant="filled" isLoading={busy} disabled={error === 'copy-failed'} onClick={() => void confirm()}>{w.keep[choice]}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
