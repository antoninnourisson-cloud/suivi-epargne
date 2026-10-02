// Filet de sécurité de l'interface : une erreur d'affichage (ou un morceau de l'app qui ne
// se charge plus après une mise à jour) montre un message et un bouton, au lieu d'un écran
// blanc.
import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

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
      <div role="alert" className="max-w-md mx-auto mt-12 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900 rounded-2xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-700 mx-auto mb-3" aria-hidden="true" />
        <h2 className="font-black text-slate-800 dark:text-slate-100 mb-1">Cet écran n'a pas pu s'afficher</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">Une nouvelle version de Pécule est peut-être disponible. Vos données ne sont pas touchées.</p>
        <button onClick={() => window.location.reload()} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-sm">
          <RotateCw className="w-4 h-4" aria-hidden="true" /> Recharger
        </button>
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
        const KEY = 'chunk_reload_at';
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
