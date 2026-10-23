// Filet de sécurité de l'interface : une erreur d'affichage (ou un morceau de l'app qui ne
// se charge plus après une mise à jour) montre un message et un bouton, au lieu d'un écran
// blanc.
import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './ui';
import { storageKey } from '../lib/storageKeys';

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  override componentDidCatch(error: Error) { console.error('Erreur d\'affichage', error); }

  override componentDidUpdate(prev: { resetKey?: string }) {
    // Changer d'écran efface l'erreur : l'utilisateur n'est pas bloqué sur le message.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
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
 */
// Même contrainte que React.lazy (ComponentType<any>) : tout autre type perd les props des écrans.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyWithRetry = <T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) =>
  React.lazy(async () => {
    try {
      return await factory();
    } catch {
      await new Promise(r => setTimeout(r, 800));
      try {
        return await factory();
      } catch (e) {
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
