// Indicateur de synchronisation (barre latérale et en-tête mobile) : une seule situation à la
// fois (voir syncPhase), deux présentations. Le libellé court de l'en-tête tient sur mobile.
// Touché (ou cliqué), il ouvre une petite feuille : l'état en clair, la dernière écriture sur
// Drive (date et heure), les modifications en attente, et « Réessayer » si l'envoi a échoué
// ou attend.
import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { SyncBlockReason, SyncPhase } from '../lib/sync/syncStatus';
import { Modal } from '../components/Modal';
import { Button } from '../components/ui';

const timeHM = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const DOT: Record<SyncPhase['kind'], string> = {
  offline: 'bg-outline',
  blocked: 'bg-error',
  saving: 'bg-tertiary animate-pulse',
  error: 'bg-error',
  conflict: 'bg-error',
  saved: 'bg-gain',
  idle: 'bg-gain',
};

/** Envoi arrêté : ce qu'il faut faire, en clair (libellé complet, libellé court). */
const BLOCKED_LABEL: Record<SyncBlockReason, readonly [string, string]> = {
  session: ['Reconnexion requise', 'Reconnexion'],
  outdated: ['Mise à jour requise', 'Mise à jour'],
  'load-failed': ['Chargement échoué', 'Erreur'],
};

/** Libellé de l'indicateur : complet (barre latérale) ou court (en-tête mobile). */
export const syncLabel = (phase: SyncPhase, variant: 'full' | 'short'): string => {
  switch (phase.kind) {
    case 'offline': return 'Hors ligne';
    case 'blocked': return BLOCKED_LABEL[phase.reason][variant === 'full' ? 0 : 1];
    case 'saving': return 'Sauvegarde...';
    case 'error': return variant === 'full' ? 'Erreur sync' : 'Erreur';
    case 'conflict': return 'Conflit';
    case 'saved': return variant === 'full' ? `Sur Drive à ${timeHM(phase.at)}` : timeHM(phase.at);
    case 'idle': return variant === 'full' ? 'Synchronisé' : 'À jour';
  }
};

/** Infobulle : la dernière écriture confirmée, et si rien n'est envoyé pour l'instant. */
export const syncTitle = (phase: SyncPhase, lastSavedAt: Date | null): string | undefined => {
  const last = lastSavedAt ? `Dernière écriture confirmée sur Drive : ${lastSavedAt.toLocaleTimeString('fr-FR')}` : undefined;
  if (phase.kind !== 'blocked') return last;
  const now = 'Vos modifications restent sur cet appareil : rien n’est envoyé sur Drive pour l’instant.';
  return last ? `${now} ${last}` : now;
};

/** Phrase d'état de la feuille de détail. */
export const syncHeadline = (phase: SyncPhase, pending: boolean): string => {
  switch (phase.kind) {
    case 'offline': return 'Hors ligne : vos modifications restent sur cet appareil et partiront au retour du réseau.';
    case 'blocked':
      return phase.reason === 'session' ? 'Reconnexion à Google nécessaire : rien n’est envoyé sur Drive pour l’instant.'
        : phase.reason === 'outdated' ? 'Votre fichier a été écrit par une version plus récente de Pécule : mettez l’app à jour pour envoyer vos modifications.'
        : 'Le chargement depuis Drive a échoué : rien n’est envoyé tant qu’il n’a pas réussi.';
    case 'saving': return 'Envoi sur Drive en cours…';
    case 'error': return 'Le dernier envoi sur Drive a échoué. Un nouvel essai est prévu ; vous pouvez aussi réessayer maintenant.';
    case 'conflict': return 'Vos modifications et celles d’un autre appareil se croisent : un choix vous attend.';
    case 'saved':
    case 'idle': return pending ? 'Des modifications sont en attente d’envoi.' : 'À jour : vos données sont sur votre Drive.';
  }
};

// « le 29 oct. à 14:32 »
const formatWhen = (d: Date) =>
  `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${timeHM(d)}`;

/** « Réessayer » : envoi en échec, hors ligne, chargement raté, ou modifications en attente. */
export const canRetrySync = (phase: SyncPhase, pending: boolean): boolean =>
  phase.kind === 'error' || phase.kind === 'offline'
  || (phase.kind === 'blocked' && phase.reason === 'load-failed')
  || (pending && (phase.kind === 'saved' || phase.kind === 'idle'));

interface SyncStatusProps {
  phase: SyncPhase;
  lastSavedAt: Date | null;
  variant: 'full' | 'short';
  /** Ouvre la feuille de détail (SyncDetailSheet, rendue une fois par AppShell). */
  onOpen: () => void;
}

/** Indicateur touchable : ouvre le détail. */
export const SyncStatus: React.FC<SyncStatusProps> = ({ phase, lastSavedAt, variant, onOpen }) => {
  const label = syncLabel(phase, variant);
  return (
    <button type="button" onClick={onOpen} title={syncTitle(phase, lastSavedAt)} aria-haspopup="dialog"
      aria-label={`Synchronisation : ${syncLabel(phase, 'full')}. Voir le détail`}
      className={`touch-target flex items-center rounded-full hover:bg-on-surface/8 ${variant === 'full' ? 'gap-2 -mx-2 px-2 h-8' : 'gap-1.5 px-2 h-10'}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[phase.kind]}`} aria-hidden="true"></span>
      {variant === 'full' ? label : <span className="text-xs font-medium text-on-surface-variant">{label}</span>}
    </button>
  );
};

interface SyncDetailSheetProps {
  open: boolean;
  onClose: () => void;
  phase: SyncPhase;
  lastSavedAt: Date | null;
  /** Des modifications de cet appareil ne sont pas encore sur Drive. */
  pending: boolean;
  onRetry: () => void;
  /** Session Google expirée : « Se reconnecter ». */
  onReconnect: () => void;
}

/**
 * Détail de la synchronisation, en feuille. Rendue hors de l'en-tête (AppShell) : l'en-tête
 * collant forme son propre plan, sous la barre du bas.
 */
export const SyncDetailSheet: React.FC<SyncDetailSheetProps> = ({ open, onClose, phase, lastSavedAt, pending, onRetry, onReconnect }) => {
  const retry = canRetrySync(phase, pending);
  const reconnect = phase.kind === 'blocked' && phase.reason === 'session';
  return (
    <Modal open={open} onClose={onClose} label="Synchronisation avec Drive" variant="sheet" className="sm:max-w-md p-6">
      <h2 className="text-2xl text-on-surface mb-3">Synchronisation avec Drive</h2>
      <p className="flex items-start gap-2 text-on-surface">
        <span className={`w-2.5 h-2.5 mt-1.5 rounded-full shrink-0 ${DOT[phase.kind]}`} aria-hidden="true"></span>
        {syncHeadline(phase, pending)}
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="text-on-surface-variant">Dernière écriture sur votre Drive</dt>
          <dd className="text-on-surface font-medium">{lastSavedAt ? formatWhen(lastSavedAt) : 'Aucune depuis l’ouverture de Pécule'}</dd>
        </div>
        <div>
          <dt className="text-on-surface-variant">Modifications en attente</dt>
          <dd className="text-on-surface font-medium">{pending ? 'Oui, sur cet appareil' : 'Aucune'}</dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="text" onClick={onClose}>Fermer</Button>
        {reconnect && <Button onClick={() => { onClose(); onReconnect(); }}>Se reconnecter</Button>}
        {retry && <Button variant="tonal" onClick={() => onRetry()}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Réessayer</Button>}
      </div>
    </Modal>
  );
};
