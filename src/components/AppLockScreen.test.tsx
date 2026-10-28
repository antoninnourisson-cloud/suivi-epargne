// @vitest-environment jsdom
// Écran de verrouillage : accessible (touches nommées, refus annoncés, clavier physique,
// focus) et « Code oublié » : une demande d'abord (retrait possible 24 heures plus tard),
// puis une confirmation qui explique, laisse choisir pour les modifications pas encore sur
// Drive, et ne déverrouille jamais.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });

const svc = vi.hoisted(() => ({
  biometric: false,
  pin: true,
  cooldown: 0,
  verifyPin: vi.fn(async (_pin: string) => false),
  verifyBiometric: vi.fn(async () => false),
}));
vi.mock('../services/appLockService', () => ({
  isBiometricEnabled: () => svc.biometric,
  isPinEnabled: () => svc.pin,
  verifyPin: (pin: string) => svc.verifyPin(pin),
  verifyBiometric: () => svc.verifyBiometric(),
  getPinCooldownSeconds: () => svc.cooldown,
}));

import { AppLockScreen } from './AppLockScreen';
import { LockResetNotice } from './LockResetNotice';
import type { LockResetRequest } from '../services/appLockService';

const typeDigits = (digits: string) => {
  for (const d of digits) fireEvent.click(screen.getByRole('button', { name: d }));
};

beforeEach(() => {
  svc.biometric = false;
  svc.pin = true;
  svc.cooldown = 0;
  svc.verifyPin.mockReset().mockResolvedValue(false);
  svc.verifyBiometric.mockReset().mockResolvedValue(false);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('AppLockScreen : accessibilité', () => {
  it('repère principal, titre focalisé, touche « effacer » nommée, région d’alerte présente dès l’affichage', () => {
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} />);
    expect(screen.getByRole('main', { name: 'Pécule verrouillé' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Pécule verrouillé' }));
    expect(screen.getByRole('button', { name: 'Effacer le dernier chiffre' })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Code PIN/ })).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('');
    // Chaque bouton a un nom.
    for (const b of screen.getAllByRole('button')) expect(b.textContent || b.getAttribute('aria-label')).toBeTruthy();
  });

  it('annonce le nombre de chiffres saisis, sans jamais les dévoiler', () => {
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} />);
    typeDigits('246');
    expect(screen.getByText('3 chiffres saisis.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer le dernier chiffre' }));
    expect(screen.getByText('2 chiffres saisis.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('24');
  });

  it('code refusé : annoncé dans la région d’alerte, focus gardé sur « OK »', async () => {
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} />);
    typeDigits('111111');
    const ok = screen.getByRole('button', { name: 'OK' });
    ok.focus();
    fireEvent.click(ok);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Code incorrect. Réessayez.'));
    expect(svc.verifyPin).toHaveBeenCalledWith('111111');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText('Aucun chiffre saisi.')).toBeTruthy();
  });

  it('délai après plusieurs échecs : durée annoncée, validation impossible pendant le délai', async () => {
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} />);
    svc.verifyPin.mockImplementation(async () => { svc.cooldown = 8; return false; });
    typeDigits('111111');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Code incorrect. Réessayez dans 8 secondes.'));
    typeDigits('246813');
    expect(screen.getByRole('button', { name: 'OK' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Patientez encore 8 secondes'));
    expect(svc.verifyPin).toHaveBeenCalledTimes(1);
  });

  it('clavier physique : chiffres, retour arrière et Entrée', async () => {
    const onUnlock = vi.fn();
    svc.verifyPin.mockResolvedValue(true);
    render(<AppLockScreen onUnlock={onUnlock} onForgot={vi.fn()} />);
    for (const key of ['2', '4', '6', '9', 'Backspace', '8', '1', '3']) fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
    expect(svc.verifyPin).toHaveBeenCalledWith('246813');
  });

  it('Entrée sur un bouton reste l’action de ce bouton ; les raccourcis ne sont pas interceptés', () => {
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} />);
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    expect(screen.getByText('Aucun chiffre saisi.')).toBeTruthy();
    typeDigits('2468');
    const forgot = screen.getByRole('button', { name: 'Code oublié ou biométrie indisponible ?' });
    fireEvent.keyDown(forgot, { key: 'Enter' });
    expect(svc.verifyPin).not.toHaveBeenCalled();
  });

  it('biométrie : tentative à l’affichage, échec annoncé, le code reste proposé', async () => {
    svc.biometric = true;
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Vérification annulée ou refusée. Réessayez, ou saisissez votre code.'));
    expect(svc.verifyBiometric).toHaveBeenCalledTimes(1);
    svc.verifyBiometric.mockResolvedValue(true);
    const onUnlock = vi.fn();
    cleanup();
    render(<AppLockScreen onUnlock={onUnlock} onForgot={vi.fn()} />);
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });
});

describe('AppLockScreen : « Code oublié »', () => {
  const openForgot = () => fireEvent.click(screen.getByRole('button', { name: 'Code oublié ou biométrie indisponible ?' }));
  const request = (ready: boolean): LockResetRequest => ({
    requestedAt: new Date('2026-10-14T10:00:00Z'),
    availableAt: new Date('2026-10-15T10:00:00Z'),
    expiresAt: new Date('2026-10-21T10:00:00Z'),
    ready,
  });
  // Retrait possible : « Retirer le verrou » ouvre l'étape de confirmation.
  const openConfirm = () => fireEvent.click(screen.getByRole('button', { name: 'Retirer le verrou' }));

  it('explique la marche à suivre (délai de 24 heures), focalise le titre, et Annuler revient au code', () => {
    const onForgot = vi.fn();
    const onRequestReset = vi.fn();
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={onForgot} onRequestReset={onRequestReset} />);
    openForgot();
    const title = screen.getByRole('heading', { name: 'Code oublié ou biométrie indisponible' });
    expect(document.activeElement).toBe(title);
    expect(screen.getByText(/Il sera possible dans 24 heures/)).toBeTruthy();
    expect(screen.getByText(/il suffit de déverrouiller Pécule pour l'annuler/)).toBeTruthy();
    expect(screen.getByText(/il faudra choisir votre compte et redonner votre accord/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Me déconnecter' })).toBeNull(); // rien n'est effacé à cette étape
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onForgot).not.toHaveBeenCalled();
    expect(onRequestReset).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Code oublié ou biométrie indisponible ?' }));
  });

  it('demander le retrait : le verrou reste, la demande et sa date sont affichées', () => {
    const Harness = () => {
      const [req, setReq] = React.useState<LockResetRequest | null>(null);
      return <AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} resetRequest={req} onRequestReset={() => setReq(request(false))} />;
    };
    render(<Harness />);
    openForgot();
    fireEvent.click(screen.getByRole('button', { name: 'Demander le retrait' }));
    const notice = screen.getByRole('region', { name: 'Retrait du verrou demandé' });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Retrait du verrou demandé' }));
    expect(notice.textContent).toMatch(/Le retrait sera possible à partir du .*15 octobre/);
    expect(notice.textContent).toContain('Déverrouillez Pécule normalement : la demande sera annulée.');
    expect(screen.queryByRole('button', { name: 'Retirer le verrou' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Code oublié ou biométrie indisponible ?' })).toBeNull();
    expect(screen.getByRole('group', { name: /Code PIN/ })).toBeTruthy(); // le code reste proposé
  });

  it('demande impossible à enregistrer : annoncé, rien ne change', () => {
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} onRequestReset={() => { throw new Error('QuotaExceededError'); }} />);
    openForgot();
    fireEvent.click(screen.getByRole('button', { name: 'Demander le retrait' }));
    expect(screen.getByRole('alert').textContent).toContain('La demande n\'a pas pu être enregistrée');
    expect(screen.getByRole('heading', { name: 'Code oublié ou biométrie indisponible' })).toBeTruthy();
  });

  it('« Annuler la demande » : la demande part, le lien « Code oublié » revient et reçoit le focus', () => {
    const Harness = () => {
      const [req, setReq] = React.useState<LockResetRequest | null>(request(false));
      return <AppLockScreen onUnlock={vi.fn()} onForgot={vi.fn()} resetRequest={req} onCancelRequest={() => setReq(null)} />;
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la demande' }));
    expect(screen.queryByRole('region', { name: 'Retrait du verrou demandé' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Code oublié ou biométrie indisponible ?' }));
    expect(screen.getByText('Demande de retrait annulée.')).toBeTruthy();
  });

  it('délai écoulé : « Retirer le verrou » explique la suite avant toute déconnexion', () => {
    const onForgot = vi.fn();
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={onForgot} resetRequest={request(true)} />);
    expect(screen.getByRole('region', { name: 'Retrait du verrou demandé' }).textContent).toMatch(/Vous pouvez maintenant retirer le verrou, jusqu'au .*21 octobre/);
    openConfirm();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Retirer le verrou' }));
    expect(screen.getByText(/le verrou est retiré/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull(); // rien en attente d'envoi
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onForgot).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Retrait du verrou demandé' }));
  });

  it('modifications pas encore sur Drive : gardées par défaut', async () => {
    const onForgot = vi.fn(async () => undefined);
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={onForgot} hasUnsyncedChanges resetRequest={request(true)} />);
    openConfirm();
    expect(screen.getByRole('radiogroup', { name: /pas encore sur Drive/ })).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Les garder sur cet appareil/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Me déconnecter' }));
    await waitFor(() => expect(onForgot).toHaveBeenCalledWith({ discardUnsynced: false }));
  });

  it('modifications pas encore sur Drive : effacées seulement sur choix explicite', async () => {
    const onForgot = vi.fn(async () => undefined);
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={onForgot} hasUnsyncedChanges resetRequest={request(true)} />);
    openConfirm();
    fireEvent.click(screen.getByRole('radio', { name: /Les effacer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Effacer et me déconnecter' }));
    await waitFor(() => expect(onForgot).toHaveBeenCalledWith({ discardUnsynced: true }));
  });

  it('échec de la fermeture de session : annoncé, le verrou reste, on peut réessayer', async () => {
    const onUnlock = vi.fn();
    const onForgot = vi.fn(async () => { throw new Error('SESSION_STILL_OPEN'); });
    render(<AppLockScreen onUnlock={onUnlock} onForgot={onForgot} resetRequest={request(true)} />);
    openConfirm();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Me déconnecter' })); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('le verrou reste en place'));
    expect(onUnlock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Me déconnecter' }).getAttribute('aria-busy')).toBeNull();
  });

  it('demande expirée entre-temps : refus annoncé, rien n’est effacé', async () => {
    const onForgot = vi.fn(async () => { throw new Error('NOT_READY'); });
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={onForgot} resetRequest={request(true)} />);
    openConfirm();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Me déconnecter' })); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('pas encore possible'));
  });

  it('autres appareils pas prévenus (hors ligne) : refus annoncé, il faut se connecter à Internet', async () => {
    const onForgot = vi.fn(async () => { throw new Error('ALERT_NOT_SENT'); });
    render(<AppLockScreen onUnlock={vi.fn()} onForgot={onForgot} resetRequest={request(true)} />);
    openConfirm();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Me déconnecter' })); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('connectez cet appareil à Internet'));
  });

  it('LockResetNotice : « J’ai retrouvé mon code » revient au verrou', () => {
    const onCancel = vi.fn();
    render(<LockResetNotice onCancel={onCancel} />);
    expect(screen.getByText(/sera retiré une fois vos données chargées depuis Drive/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'J\'ai retrouvé mon code' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
