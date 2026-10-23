// Bannières de synchronisation en haut de l'écran (hors ligne, version trop ancienne, session
// expirée, choix entre deux versions, fichier en double, erreur, copie locale, copie locale
// illisible), et les toasts
// discrets qui suivent la synchronisation.
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { Button } from '../components/ui';
import { syncErrorText } from '../lib/syncErrors';
import type { PortfolioData } from '../hooks/usePortfolioData';
import type { AddToast } from './UiProviders';

type BannerData = Pick<PortfolioData,
  'offlineDataAt' | 'isOffline' | 'isLoadingData' | 'dataShown' | 'appOutdated' | 'sessionExpired' | 'syncConflict'
  | 'duplicateFile' | 'syncError' | 'syncErrorInfo' | 'loadFailed' | 'localBackup' | 'unreadableLocalCopy'
  | 'retrySync' | 'dismissDuplicate' | 'compareDuplicate' | 'restoreLocalBackup' | 'dismissLocalBackup' | 'dismissUnreadableCopy'>;

interface SyncBannersProps {
  data: BannerData;
  onReconnect: () => void;
  /** Ouvre l'écran de choix entre deux versions. */
  onOpenConflict: () => void;
}

export const SyncBanners: React.FC<SyncBannersProps> = ({ data, onReconnect, onOpenConflict }) => (
  <>
    {data.offlineDataAt ? (
      // Démarrage hors ligne : dernière copie connue, saisies gardées sur l'appareil.
      <div role="status" className="mb-4 bg-surface-container-high text-on-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="flex items-start gap-2 text-sm">
          <WifiOff className="w-5 h-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
          <span>
            <strong className="font-bold">Hors ligne : données du {new Date(data.offlineDataAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</strong>, la dernière fois que Pécule a pu joindre Drive.
            {' '}Vos modifications restent sur cet appareil et partiront sur Drive au retour du réseau.
          </span>
        </p>
        <Button variant="tonal" className="shrink-0" isLoading={data.isLoadingData} onClick={data.retrySync}>{data.isLoadingData ? 'Connexion à Drive…' : 'Réessayer'}</Button>
      </div>
    ) : data.isOffline && (
      <div role="status" className="mb-4 inline-flex flex-wrap items-center gap-2 bg-surface-container text-on-surface-variant rounded-2xl px-3 py-1.5 text-sm font-medium">
        <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" /> {data.dataShown
          ? 'Hors ligne ou Drive injoignable : vos modifications restent sur cet appareil et partiront sur Drive dès que possible.'
          : 'Hors ligne : vos données s\'afficheront dès que Drive sera joignable.'}
        <button onClick={data.retrySync} className="underline underline-offset-2 text-on-surface hover:no-underline">Réessayer</button>
      </div>
    )}
    {data.appOutdated && (
      <div role="alert" className="mb-4 bg-tertiary-container text-on-tertiary-container rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true"/> Vos données ont été enregistrées par une version plus récente de Pécule. Mettez l'app à jour : rien ne sera enregistré d'ici là.</div>
        <Button variant="filled" className="shrink-0" onClick={() => window.location.reload()}>Mettre à jour</Button>
      </div>
    )}
    {data.sessionExpired && (
      <div role="alert" className="mb-4 bg-tertiary-container text-on-tertiary-container rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true"/> Votre session Google a expiré. Reconnectez-vous pour continuer à sauvegarder.</div>
        <Button variant="filled" className="shrink-0" onClick={onReconnect}>Se reconnecter</Button>
      </div>
    )}
    {data.syncConflict && (
      <div role="alert" className="mb-4 bg-tertiary-container text-on-tertiary-container rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true"/> Vos données ont changé ici et sur un autre appareil. Rien n'est enregistré tant que vous n'avez pas choisi la version à garder.</div>
        <Button variant="filled" className="shrink-0" onClick={onOpenConflict}>Comparer et choisir</Button>
      </div>
    )}
    {data.duplicateFile && !data.syncConflict && (
      <div role="status" className="mb-4 bg-surface-container text-on-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm"><AlertTriangle className="w-5 h-5 shrink-0 text-on-surface-variant" aria-hidden="true"/> Un autre fichier de données Pécule existe sur votre Drive{data.duplicateFile.modifiedTime ? ` (modifié le ${new Date(data.duplicateFile.modifiedTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })})` : ''}. Pécule a ouvert le plus récent.</div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="text" onClick={data.dismissDuplicate}>Ignorer</Button>
          <Button variant="tonal" onClick={() => { data.compareDuplicate(); onOpenConflict(); }}>Comparer</Button>
        </div>
      </div>
    )}
    {data.syncError && !data.sessionExpired && !data.syncConflict && !data.isOffline && (
      <div role="alert" className="mb-4 bg-error-container text-on-error-container rounded-2xl p-4 text-sm font-medium flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <span className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true"/> {syncErrorText(data.loadFailed ? 'load' : 'save', data.syncErrorInfo?.reason)}</span>
        {/* Recharge si le chargement a échoué, sinon réécrit avec contrôle de révision :
            jamais d'écriture forcée ici. */}
        <Button variant="danger" className="shrink-0" onClick={data.retrySync}>Réessayer</Button>
      </div>
    )}
    {data.localBackup && (
      <div role="status" className="mb-4 bg-secondary-container text-on-secondary-container rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true"/> Une sauvegarde locale du {new Date(data.localBackup.savedAt).toLocaleString('fr-FR')} n'a jamais été synchronisée avec Drive et diffère de ce qui est affiché. La restaurer ?</div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="filled" onClick={data.restoreLocalBackup}>Restaurer cette sauvegarde</Button>
          <Button variant="text" onClick={data.dismissLocalBackup}>Ignorer</Button>
        </div>
      </div>
    )}
    {data.unreadableLocalCopy && (
      // Copie locale jamais envoyée sur Drive, mais illisible : on le dit (avant, elle était
      // ignorée en silence, puis écrasée par la copie suivante).
      <div role="alert" className="mb-4 bg-surface-container-high text-on-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="flex items-start gap-2 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 text-error" aria-hidden="true" />
          <span>{UNREADABLE_TEXT[data.unreadableLocalCopy]}</span>
        </p>
        <Button variant="tonal" className="shrink-0" onClick={data.dismissUnreadableCopy}>Compris</Button>
      </div>
    )}
  </>
);

const UNREADABLE_TEXT: Record<'lost' | 'unavailable', string> = {
  lost: "Des modifications faites sur cet appareil, jamais envoyées sur Drive, n'ont pas pu être relues : la clé qui les protégeait sur cet appareil a été effacée (par exemple en vidant les données du navigateur). Elles ne peuvent pas être récupérées. Vos données sur Drive ne sont pas touchées.",
  unavailable: "Des modifications faites sur cet appareil, jamais envoyées sur Drive, ne peuvent pas être relues pour l'instant : le stockage protégé du navigateur est indisponible (navigation privée ?). Elles restent sur l'appareil et vous seront proposées dès qu'il le sera.",
};

/**
 * Toasts qui suivent la synchronisation : « Enregistré » après une écriture Drive CONFIRMÉE
 * (`lastSavedAt`, posé seulement après la réponse de Drive : la retombée de « Sauvegarde... »
 * affichait « Enregistré » même quand l'écriture venait d'échouer), et « mis à jour depuis un
 * autre appareil » quand Drive a été rechargé en silence.
 */
export const useSyncToasts = (lastSavedAt: Date | null, remoteUpdatedAt: number | null, addToast: AddToast) => {
  useEffect(() => {
    if (remoteUpdatedAt) addToast({ message: 'Données mises à jour depuis un autre appareil', kind: 'info' });
  }, [remoteUpdatedAt, addToast]);

  const lastToastedSaveRef = useRef<number | null>(null);
  useEffect(() => {
    if (!lastSavedAt) return;
    const ts = lastSavedAt.getTime();
    if (lastToastedSaveRef.current === ts) return;
    // Pas de toast pour la toute première valeur observée (montage), seulement sur un vrai
    // enregistrement survenu pendant la session.
    if (lastToastedSaveRef.current !== null) addToast({ message: 'Enregistré', kind: 'success', durationMs: 1500 });
    lastToastedSaveRef.current = ts;
  }, [lastSavedAt, addToast]);
};
