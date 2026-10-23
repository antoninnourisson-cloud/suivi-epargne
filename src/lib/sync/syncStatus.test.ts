import { describe, it, expect } from 'vitest';
import { initialSyncStatus, isSettledOnDrive, sendBlocker, syncPhase, syncReducer, type SyncEvent, type SyncStatus } from './syncStatus';

const base = initialSyncStatus(true);
const run = (events: SyncEvent[], from: SyncStatus = base) => events.reduce(syncReducer, from);
const transient = { reason: 'server' as const, transient: true };

describe('état de la synchronisation (transitions)', () => {
  it('démarre en ligne ou hors ligne selon le navigateur, sans rien à signaler', () => {
    expect(base).toEqual({ loading: false, saving: false, offline: false, loadFailed: false, sessionExpired: false, appOutdated: false, error: null });
    expect(initialSyncStatus(false).offline).toBe(true);
  });

  it('un nouveau chargement oublie session expirée, échec et erreur précédents, pas le hors ligne', () => {
    const before = run([{ type: 'offline' }, { type: 'session-expired' }, { type: 'load-failed' }, { type: 'error', info: transient }]);
    const s = syncReducer(before, { type: 'load-start' });
    expect(s).toMatchObject({ loading: true, sessionExpired: false, loadFailed: false, error: null, offline: true });
    expect(syncReducer(s, { type: 'load-end' }).loading).toBe(false);
  });

  it('chargement impossible faute de réseau : échec ET hors ligne ; sinon le réseau ne change pas', () => {
    expect(run([{ type: 'load-failed', offline: true }])).toMatchObject({ loadFailed: true, offline: true });
    expect(run([{ type: 'load-failed' }])).toMatchObject({ loadFailed: true, offline: false });
  });

  it('rien ne change : même objet (pas de nouveau rendu)', () => {
    expect(syncReducer(base, { type: 'online' })).toBe(base);
    expect(syncReducer(base, { type: 'load-end' })).toBe(base);
    expect(syncReducer(base, { type: 'error-cleared' })).toBe(base);
    expect(syncReducer(base, { type: 'saving', value: false })).toBe(base);
    expect(syncReducer(base, { type: 'outdated', value: false })).toBe(base);
    const failed = run([{ type: 'load-failed', offline: true }]);
    expect(syncReducer(failed, { type: 'load-failed' })).toBe(failed);
    expect(syncReducer(failed, { type: 'load-failed', offline: true })).toBe(failed);
    const expired = run([{ type: 'session-expired' }]);
    expect(syncReducer(expired, { type: 'session-expired' })).toBe(expired);
  });

  it('écriture, version trop ancienne, erreur : chacune se pose et se retire', () => {
    const s = run([{ type: 'saving', value: true }, { type: 'outdated', value: true }, { type: 'error', info: transient }]);
    expect(s).toMatchObject({ saving: true, appOutdated: true, error: transient });
    expect(run([{ type: 'saving', value: false }, { type: 'outdated', value: false }, { type: 'error-cleared' }], s))
      .toMatchObject({ saving: false, appOutdated: false, error: null });
  });

  it('déconnexion : plus rien à signaler, le réseau reste ce qu’il est', () => {
    const s = run([{ type: 'offline' }, { type: 'load-failed' }, { type: 'session-expired' }, { type: 'outdated', value: true }, { type: 'error', info: transient }, { type: 'reset' }]);
    expect(s).toEqual({ ...base, offline: true });
  });
});

describe('indicateur : une seule situation, par ordre de priorité', () => {
  const at = new Date(2026, 9, 20, 9, 30);
  it('hors ligne, puis écriture, puis erreur, puis choix en attente, puis dernière écriture', () => {
    const all = run([{ type: 'offline' }, { type: 'saving', value: true }, { type: 'error', info: transient }]);
    expect(syncPhase(all, true, at)).toEqual({ kind: 'offline' });
    expect(syncPhase({ ...all, offline: false }, true, at)).toEqual({ kind: 'saving' });
    expect(syncPhase({ ...all, offline: false, saving: false }, true, at)).toEqual({ kind: 'error' });
    expect(syncPhase(base, true, at)).toEqual({ kind: 'conflict' });
    expect(syncPhase(base, false, at)).toEqual({ kind: 'saved', at });
    expect(syncPhase(base, false, null)).toEqual({ kind: 'idle' });
  });

  it('envoi arrêté : jamais « Synchronisé », même après une écriture confirmée', () => {
    const blocked = (events: SyncEvent[]) => syncPhase(run(events), false, at);
    // Session expirée : la panne la plus fréquente, sans erreur affichée (error reste vide).
    expect(blocked([{ type: 'session-expired' }])).toEqual({ kind: 'blocked', reason: 'session' });
    expect(blocked([{ type: 'outdated', value: true }])).toEqual({ kind: 'blocked', reason: 'outdated' });
    expect(blocked([{ type: 'load-failed' }])).toEqual({ kind: 'blocked', reason: 'load-failed' });
    // Passe avant une écriture, une erreur ou un choix en attente ; la raison la plus utile d'abord.
    const all = run([{ type: 'load-failed' }, { type: 'outdated', value: true }, { type: 'session-expired' }, { type: 'saving', value: true }, { type: 'error', info: transient }]);
    expect(syncPhase(all, true, at)).toEqual({ kind: 'blocked', reason: 'session' });
    expect(syncPhase({ ...all, sessionExpired: false }, true, at)).toEqual({ kind: 'blocked', reason: 'outdated' });
    expect(syncPhase({ ...all, sessionExpired: false, appOutdated: false }, true, at)).toEqual({ kind: 'blocked', reason: 'load-failed' });
    // Hors ligne d'abord : c'est le réseau qu'on signale (chargement raté faute de réseau).
    expect(blocked([{ type: 'load-failed', offline: true }, { type: 'session-expired' }])).toEqual({ kind: 'offline' });
    // Un nouveau chargement lève le blocage ; la déconnexion aussi.
    expect(blocked([{ type: 'session-expired' }, { type: 'load-start' }, { type: 'load-end' }])).toEqual({ kind: 'saved', at });
    expect(blocked([{ type: 'outdated', value: true }, { type: 'reset' }])).toEqual({ kind: 'saved', at });
  });
});

describe('« Envoyer puis se déconnecter »', () => {
  const none = { conflictOpen: false, hasLocalBackup: false };
  it('possible quand rien ne bloque', () => {
    expect(sendBlocker(base, none)).toBeNull();
  });
  it('la raison la plus utile d’abord', () => {
    const all = run([{ type: 'offline' }, { type: 'load-failed' }, { type: 'session-expired' }, { type: 'outdated', value: true }]);
    expect(sendBlocker(all, { conflictOpen: true, hasLocalBackup: true })).toBe('local-backup');
    expect(sendBlocker(all, { conflictOpen: true, hasLocalBackup: false })).toBe('conflict');
    expect(sendBlocker(all, none)).toBe('session');
    expect(sendBlocker({ ...all, sessionExpired: false }, none)).toBe('outdated');
    expect(sendBlocker(run([{ type: 'load-failed' }]), none)).toBe('load-failed');
    // Chargement raté faute de réseau : c'est le réseau qu'on signale.
    expect(sendBlocker(run([{ type: 'load-failed', offline: true }]), none)).toBe('offline');
    expect(sendBlocker(run([{ type: 'offline' }]), none)).toBe('offline');
  });
});

describe('sauvegarde de secours : seulement depuis des données de Drive sans rien en suspens', () => {
  const ok = { dataShown: true, offlineCopyShown: false, conflictOpen: false, hasLocalBackup: false };
  it('données chargées, rien en suspens', () => {
    expect(isSettledOnDrive(base, ok)).toBe(true);
  });
  it('chaque doute l’empêche', () => {
    expect(isSettledOnDrive(base, { ...ok, dataShown: false })).toBe(false);
    expect(isSettledOnDrive(base, { ...ok, offlineCopyShown: true })).toBe(false);
    expect(isSettledOnDrive(base, { ...ok, conflictOpen: true })).toBe(false);
    expect(isSettledOnDrive(base, { ...ok, hasLocalBackup: true })).toBe(false);
    for (const e of [{ type: 'load-failed' }, { type: 'load-start' }, { type: 'session-expired' }, { type: 'outdated', value: true }, { type: 'error', info: transient }] as SyncEvent[]) {
      expect(isSettledOnDrive(syncReducer(base, e), ok)).toBe(false);
    }
  });
});
