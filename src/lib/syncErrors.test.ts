import { describe, it, expect } from 'vitest';
import { classifySyncFailure, SYNC_ERROR_MESSAGES, SYNC_LOAD_ERROR_MESSAGES, syncErrorText } from './syncErrors';

describe('classifySyncFailure', () => {
  it('pannes passagères : nouvel essai automatique', () => {
    expect(classifySyncFailure({ status: 503 })).toEqual({ reason: 'server', transient: true });
    expect(classifySyncFailure({ status: 500 })).toEqual({ reason: 'server', transient: true });
    expect(classifySyncFailure({ status: 429 })).toEqual({ reason: 'rate-limit', transient: true });
    expect(classifySyncFailure({ status: 403, reason: 'userRateLimitExceeded' })).toEqual({ reason: 'rate-limit', transient: true });
    expect(classifySyncFailure({ status: 403, reason: 'rateLimitExceeded' })).toEqual({ reason: 'rate-limit', transient: true });
    expect(classifySyncFailure({ name: 'TypeError', message: 'Failed to fetch' })).toEqual({ reason: 'network', transient: true });
    expect(classifySyncFailure({ name: 'Error', message: 'REVISION_UNAVAILABLE' }).transient).toBe(true);
  });

  it('blocages durables : pas de boucle de nouveaux essais', () => {
    expect(classifySyncFailure({ status: 403, reason: 'storageQuotaExceeded' })).toEqual({ reason: 'quota', transient: false });
    expect(classifySyncFailure({ status: 403, reason: 'insufficientFilePermissions' })).toEqual({ reason: 'permission', transient: false });
    expect(classifySyncFailure({ status: 404 })).toEqual({ reason: 'rejected', transient: false });
    expect(classifySyncFailure({ status: 400, reason: 'badRequest' })).toEqual({ reason: 'rejected', transient: false });
    expect(classifySyncFailure({ name: 'SyntaxError', message: 'Unexpected token' })).toEqual({ reason: 'malformed', transient: false });
    expect(classifySyncFailure({ name: 'Error', message: 'EMPTY_FILE' })).toEqual({ reason: 'malformed', transient: false });
  });

  it('inconnu : on préfère réessayer', () => {
    expect(classifySyncFailure({ name: 'Error', message: 'bizarre' })).toEqual({ reason: 'unknown', transient: true });
  });

  it('chaque raison a un message en clair', () => {
    for (const msg of Object.values(SYNC_ERROR_MESSAGES)) expect(msg.length).toBeGreaterThan(5);
  });

  it('un chargement raté ne parle jamais d’enregistrement ni de droit de modifier', () => {
    for (const msg of Object.values(SYNC_LOAD_ERROR_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(5);
      expect(msg).not.toMatch(/enregistrement|modifier/);
    }
    expect(syncErrorText('load', 'rejected')).toBe('Impossible de charger vos données depuis Drive (rien n\'y a été modifié). Drive a refusé la demande. Touchez « Réessayer » ; si cela continue, déconnectez-vous puis reconnectez-vous.');
    expect(syncErrorText('save', 'rejected')).toMatch(/^La dernière sauvegarde a échoué\. Drive a refusé l'enregistrement/);
    expect(syncErrorText('save')).toBe('La dernière sauvegarde a échoué. Nouvel essai automatique.');
  });
});
