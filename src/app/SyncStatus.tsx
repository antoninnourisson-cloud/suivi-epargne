// Indicateur de synchronisation (barre latérale et en-tête mobile) : une seule situation à la
// fois (voir syncPhase), deux présentations. Le libellé court de l'en-tête tient sur mobile.
import React from 'react';
import type { SyncBlockReason, SyncPhase } from '../lib/sync/syncStatus';

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
    case 'idle': return variant === 'full' ? 'Synchronisé' : 'Sync';
  }
};

/** Infobulle : la dernière écriture confirmée, et si rien n'est envoyé pour l'instant. */
export const syncTitle = (phase: SyncPhase, lastSavedAt: Date | null): string | undefined => {
  const last = lastSavedAt ? `Dernière écriture confirmée sur Drive : ${lastSavedAt.toLocaleTimeString('fr-FR')}` : undefined;
  if (phase.kind !== 'blocked') return last;
  const now = 'Vos modifications restent sur cet appareil : rien n’est envoyé sur Drive pour l’instant.';
  return last ? `${now} ${last}` : now;
};

export const SyncStatus: React.FC<{ phase: SyncPhase; lastSavedAt: Date | null; variant: 'full' | 'short' }> = ({ phase, lastSavedAt, variant }) => (
  <div className={`flex items-center ${variant === 'full' ? 'gap-2' : 'gap-1.5'}`} title={syncTitle(phase, lastSavedAt)}>
    <div className={`w-2 h-2 rounded-full shrink-0 ${DOT[phase.kind]}`}></div>
    {variant === 'full' ? syncLabel(phase, variant) : <span className="text-xs font-medium text-on-surface-variant">{syncLabel(phase, variant)}</span>}
  </div>
);
