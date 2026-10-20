// ================================================
// FILE: src/components/BootSkeleton.tsx
// Écran de démarrage : la structure de l'app (barre latérale ou en-tête, navigation, cartes
// en attente) s'affiche tout de suite, pendant que la session et les données arrivent.
// Aucune donnée ni action ici : rien ne peut être saisi avant le chargement.
// ================================================
import React from 'react';
import { Logo } from './Logo';

const Block: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded-3xl bg-surface-container-high motion-safe:animate-pulse ${className}`} />
);

export const BootSkeleton: React.FC<{ message?: string }> = ({ message = 'Chargement de vos données…' }) => (
  <div className="min-h-screen bg-surface flex flex-col md:flex-row font-sans text-on-surface">
    <aside className="hidden md:flex bg-surface-container-low w-72 shrink-0 flex-col" aria-hidden="true">
      <div className="px-7 pt-6 pb-3">
        <div className="text-2xl font-bold text-primary dark:text-on-surface flex items-center gap-3"><Logo className="w-9 h-9" /> Pécule</div>
        <div className="mt-4 h-3 w-32 rounded-full bg-surface-container-high" />
      </div>
      <div className="px-7 pt-4 space-y-5">
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-4 rounded-full bg-surface-container-high" style={{ width: `${60 + ((i * 17) % 35)}%` }} />)}
      </div>
    </aside>
    <header className="md:hidden sticky top-0 z-30 bg-surface-container px-4 h-16 flex items-center" aria-hidden="true">
      <div className="text-[22px] font-bold text-primary dark:text-on-surface flex items-center gap-2"><Logo className="w-8 h-8" /> Pécule</div>
    </header>
    <main className="flex-1 p-4 md:p-8 pb-24" aria-busy="true">
      <div className="max-w-7xl mx-auto space-y-4">
        <p role="status" className="text-sm font-medium text-on-surface-variant">{message}</p>
        <Block className="h-28" />
        <div className="grid grid-cols-2 gap-4"><Block className="h-28" /><Block className="h-28" /></div>
        <Block className="h-64" />
      </div>
    </main>
    <div className="md:hidden fixed bottom-0 left-0 right-0 h-20 bg-surface-container pb-[env(safe-area-inset-bottom)]" aria-hidden="true" />
  </div>
);
