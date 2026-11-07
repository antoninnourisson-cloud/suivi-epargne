// Filet de sécurité de l'interface : une erreur d'affichage (ou un morceau de l'app qui ne
// se charge plus après une mise à jour) montre un message et un bouton, au lieu d'un écran
// blanc. Deux niveaux : autour de chaque écran (ErrorBoundary : le reste de l'app continue de
// marcher), et autour de toute l'app (RootErrorBoundary, index.tsx : barre du haut, fenêtres,
// écran de verrou, fournisseurs). Chaque erreur rattrapée est notée dans le journal de
// l'appareil (lib/errorJournal, Paramètres > Appareil).
import React from 'react';
import { AlertTriangle, RotateCw, WifiOff } from 'lucide-react';
import { Button } from './ui';
import { storageKey } from '../lib/storageKeys';
import { recordError } from '../lib/errorJournal';

interface State { error: Error | null }

/**
 * Écran chargé à la demande, absent du cache de l'appareil, alors que l'appareil est hors
 * réseau : ce n'est ni un bug ni une nouvelle version, il suffit d'attendre le réseau.
 * `retry` : prépare un nouveau chargement (React.lazy garde sinon l'échec en mémoire).
 */
export class NeedsNetworkError extends Error {
  retry: () => void;
  constructor(retry: () => void) { super('SCREEN_NEEDS_NETWORK'); this.name = 'NeedsNetworkError'; this.retry = retry; }
}

const noteError = (error: Error, info: React.ErrorInfo) => {
  // Attendu hors réseau : rien à journaliser.
  if (error instanceof NeedsNetworkError) return;
  console.error('Erreur d\'affichage', error);
  recordError('affichage', error, info.componentStack);
};

/**
 * Filet de toute l'app : un écran plein, sobre, au lieu d'une page blanche. Ce qu'il dit des
 * données est exact : le fichier est sur Drive, et une saisie pas encore envoyée a sa copie
 * chiffrée sur l'appareil (miroir écrit 0,6 s après chaque modification, voir useDriveSync),
 * proposée au redémarrage.
 */
export class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  override componentDidCatch(error: Error, info: React.ErrorInfo) { noteError(error, info); }

  override render() {
    if (!this.state.error) return this.props.children;
    const needsNetwork = this.state.error instanceof NeedsNetworkError ? this.state.error : null;
    if (needsNetwork) {
      return (
        <main className="min-h-dvh bg-surface text-on-surface flex items-center justify-center px-4 py-8">
          <NeedsNetworkNotice onRetry={() => { needsNetwork.retry(); this.setState({ error: null }); }} />
        </main>
      );
    }
    return (
      <main className="min-h-dvh bg-surface text-on-surface flex items-center justify-center px-4 py-8">
        <div role="alert" className="max-w-md w-full bg-surface-container-low rounded-3xl p-6 text-center">
          <span className="w-12 h-12 mx-auto mb-4 rounded-full bg-error-container text-on-error-container flex items-center justify-center" aria-hidden="true">
            <AlertTriangle className="w-6 h-6" />
          </span>
          <h1 className="text-[22px] leading-7 font-normal mb-2">Pécule a rencontré un problème</h1>
          <p className="text-sm text-on-surface-variant mb-2">
            Vos données sont sur votre Google Drive. Une modification pas encore envoyée est gardée,
            chiffrée, sur cet appareil : Pécule vous la proposera après le rechargement (seule une
            saisie de la toute dernière seconde peut manquer).
          </p>
          <p className="text-xs text-on-surface-variant mb-5">L'erreur est notée sur cet appareil, dans Paramètres &gt; Appareil.</p>
          <Button variant="filled" onClick={() => window.location.reload()}>
            <RotateCw className="w-4 h-4" aria-hidden="true" /> Recharger
          </Button>
        </div>
      </main>
    );
  }
}

/** « Cet écran a besoin du réseau la première fois. » : sobre, avec un nouvel essai. */
const NeedsNetworkNotice: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div role="alert" className="max-w-md w-full mx-auto mt-12 bg-surface-container-low text-on-surface rounded-3xl p-6 text-center">
    <WifiOff className="w-8 h-8 mx-auto mb-3 text-on-surface-variant" aria-hidden="true" />
    <h2 className="text-[22px] leading-7 font-normal mb-1">Pas de réseau</h2>
    <p className="text-sm text-on-surface-variant mb-4">Cet écran a besoin du réseau la première fois.</p>
    <Button variant="filled" onClick={onRetry}>
      <RotateCw className="w-4 h-4" aria-hidden="true" /> Réessayer
    </Button>
  </div>
);

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  override componentDidCatch(error: Error, info: React.ErrorInfo) { noteError(error, info); }

  override componentDidUpdate(prev: { resetKey?: string }) {
    // Changer d'écran efface l'erreur : l'utilisateur n'est pas bloqué sur le message.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const needsNetwork = this.state.error instanceof NeedsNetworkError ? this.state.error : null;
    if (needsNetwork) return <NeedsNetworkNotice onRetry={() => { needsNetwork.retry(); this.setState({ error: null }); }} />;
    return (
      <div role="alert" className="max-w-md mx-auto mt-12 bg-tertiary-container text-on-tertiary-container rounded-3xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3" aria-hidden="true" />
        <h2 className="text-[22px] leading-7 font-normal mb-1">Cet écran n'a pas pu s'afficher</h2>
        <p className="text-sm mb-4">Une nouvelle version de Pécule est peut-être disponible. Vos données ne sont pas touchées.</p>
        <Button variant="filled" onClick={() => window.location.reload()}>
          <RotateCw className="w-4 h-4" aria-hidden="true" /> Recharger
        </Button>
      </div>
    );
  }
}

/**
 * `React.lazy` qui survit à un déploiement : si le fichier demandé n'existe plus (onglet
 * resté ouvert sur l'ancienne version), on réessaie une fois, puis on recharge la page une
 * seule fois pour récupérer la nouvelle version.
 * Hors réseau (navigator.onLine faux), un échec n'est PAS une nouvelle version : pas de
 * rechargement (qui ne ferait que perdre l'écran en cours), mais NeedsNetworkError, que le
 * filet d'erreur explique avec un bouton « Réessayer » qui relance le chargement.
 */
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// Même contrainte que React.lazy (ComponentType<any>) : tout autre type perd les props des écrans.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyWithRetry = <T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>): React.ComponentType<React.ComponentProps<T>> => {
  const makeLazy = () => React.lazy(async () => {
    try {
      return await factory();
    } catch {
      if (isOffline()) throw new NeedsNetworkError(retry);
      await new Promise(r => setTimeout(r, 800));
      try {
        return await factory();
      } catch (e) {
        if (isOffline()) throw new NeedsNetworkError(retry);
        const KEY = storageKey('chunkReloadAt');
        const last = Number(sessionStorage.getItem(KEY) || 0);
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
          return new Promise<never>(() => {});
        }
        throw e;
      }
    }
  });
  let Inner = makeLazy();
  // React.lazy garde l'échec en mémoire : un nouvel essai demande un nouveau composant, pris au
  // prochain affichage (le filet d'erreur remonte les enfants après « Réessayer »).
  const retry = () => { Inner = makeLazy(); };
  const Screen = (props: React.ComponentProps<T>) => React.createElement(Inner as React.ComponentType<React.ComponentProps<T>>, props);
  return Screen;
};
