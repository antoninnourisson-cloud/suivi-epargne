// @vitest-environment jsdom
// Indicateur de synchronisation touchable : feuille de détail (état en clair, dernière écriture
// datée, modifications en attente), « Réessayer » seulement quand l'envoi a échoué ou attend,
// « Se reconnecter » quand la session Google a expiré.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SyncDetailSheet, SyncStatus, canRetrySync, syncHeadline } from './SyncStatus';
import type { SyncPhase } from '../lib/sync/syncStatus';

/** Indicateur et feuille, branchés comme dans AppShell. */
const Harness = ({ phase, lastSavedAt, variant, pending = false, onRetry = () => {}, onReconnect = () => {} }: {
  phase: SyncPhase; lastSavedAt: Date | null; variant: 'full' | 'short'; pending?: boolean; onRetry?: () => void; onReconnect?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  return <>
    <SyncStatus phase={phase} lastSavedAt={lastSavedAt} variant={variant} onOpen={() => setOpen(true)} />
    <SyncDetailSheet open={open} onClose={() => setOpen(false)} phase={phase} lastSavedAt={lastSavedAt} pending={pending} onRetry={onRetry} onReconnect={onReconnect} />
  </>;
};

afterEach(cleanup);

const at = new Date(2026, 9, 29, 14, 32);

describe('canRetrySync', () => {
  it('échec, hors ligne, chargement raté, ou modifications en attente', () => {
    expect(canRetrySync({ kind: 'error' }, false)).toBe(true);
    expect(canRetrySync({ kind: 'offline' }, false)).toBe(true);
    expect(canRetrySync({ kind: 'blocked', reason: 'load-failed' }, false)).toBe(true);
    expect(canRetrySync({ kind: 'saved', at }, true)).toBe(true);
    expect(canRetrySync({ kind: 'idle' }, true)).toBe(true);
  });
  it('jamais quand tout est à jour, pendant un envoi, ou si la session ou la version bloque', () => {
    expect(canRetrySync({ kind: 'saved', at }, false)).toBe(false);
    expect(canRetrySync({ kind: 'idle' }, false)).toBe(false);
    expect(canRetrySync({ kind: 'saving' }, true)).toBe(false);
    expect(canRetrySync({ kind: 'blocked', reason: 'session' }, true)).toBe(false);
    expect(canRetrySync({ kind: 'blocked', reason: 'outdated' }, true)).toBe(false);
    expect(canRetrySync({ kind: 'conflict' }, true)).toBe(false);
  });
});

describe('syncHeadline', () => {
  it('« À jour » seulement sans rien en attente', () => {
    expect(syncHeadline({ kind: 'saved', at }, false)).toMatch(/^À jour/);
    expect(syncHeadline({ kind: 'idle' }, true)).toMatch(/en attente/);
    const phases: SyncPhase[] = [{ kind: 'offline' }, { kind: 'saving' }, { kind: 'error' }, { kind: 'conflict' },
      { kind: 'blocked', reason: 'session' }, { kind: 'blocked', reason: 'outdated' }, { kind: 'blocked', reason: 'load-failed' }];
    for (const p of phases) expect(syncHeadline(p, false)).not.toMatch(/^À jour/);
  });
});

describe('SyncStatus', () => {
  it('à jour : la feuille montre la date de la dernière écriture, sans « Réessayer »', () => {
    const onRetry = vi.fn();
    render(<Harness phase={{ kind: 'saved', at }} lastSavedAt={at} variant="short" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /Synchronisation : Sur Drive à 14:32/ }));
    const sheet = screen.getByRole('dialog', { name: 'Synchronisation avec Drive' });
    expect(sheet.textContent).toContain('À jour : vos données sont sur votre Drive.');
    expect(sheet.textContent).toContain('le 29 oct. à 14:32');
    expect(sheet.textContent).toContain('Aucune');
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('envoi en échec avec des modifications en attente : « Réessayer » relance, la feuille reste ouverte', () => {
    const onRetry = vi.fn();
    render(<Harness phase={{ kind: 'error' }} lastSavedAt={null} variant="short" pending onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /Synchronisation : Erreur sync/ }));
    const sheet = screen.getByRole('dialog', { name: 'Synchronisation avec Drive' });
    expect(sheet.textContent).toContain('Oui, sur cet appareil');
    expect(sheet.textContent).toContain('Aucune depuis l’ouverture de Pécule');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('session expirée : « Se reconnecter », pas « Réessayer »', () => {
    const onReconnect = vi.fn();
    render(<Harness phase={{ kind: 'blocked', reason: 'session' }} lastSavedAt={null} variant="full" pending onRetry={() => {}} onReconnect={onReconnect} />);
    fireEvent.click(screen.getByRole('button', { name: /Synchronisation : Reconnexion requise/ }));
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Se reconnecter' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
