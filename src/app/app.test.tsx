// @vitest-environment jsdom
// Morceaux d'App (src/app) : liens directs, écran courant, indicateur de synchronisation,
// actions sur les données (confirmation, toast, annulation) et écran mémoïsé (pas de rendu
// inutile quand seul App change).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { emptyData } from '../lib/schema';
import { AccountType, type AppDoc, type SavingsAccount } from '../types';
import { stripParam, useDeepLinks, useViewState } from './useAppNavigation';
import { clearRequestedSection, OPEN_SECTION_EVENT, peekRequestedSection } from '../components/settings/sections';
import { syncLabel, syncTitle } from './SyncStatus';
import { useAccountActions } from './useAccountActions';
import { UiProviders, useAddToast, useDialog, useMainUiShown, type AddToast, type DialogApi } from './UiProviders';

const renders: Record<string, number> = {};
vi.mock('./screens', () => {
  const stub = (name: string) => () => { renders[name] = (renders[name] ?? 0) + 1; return <div data-testid={name} />; };
  const names = ['AccountUpdate', 'AccountsView', 'Agenda', 'AssistantPilot', 'CloudBackupPanel', 'Dashboard', 'Donations', 'DriveBackupsPanel',
    'FiscalWatchCard', 'History', 'Journal', 'MotivationSettings', 'ParentalShare', 'Payslips', 'ServerSecurityPanel',
    'SetAsideVersionsPanel', 'Settings', 'Simulator', 'SoloPlanCard', 'Subscriptions', 'TaxNoticePanel', 'TaxReturnHelper',
    'TransferManager', 'Yield', 'ViewLoader'];
  return {
    ...Object.fromEntries(names.map(n => [n, stub(n)])),
    Lazy: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
import { ScreenRouter, type AccountFormState, type ScreenData } from './ScreenRouter';
import type { DerivedData } from './useDerivedData';
import type { AccountActions } from './useAccountActions';
import type { FiscalWatch } from '../hooks/useFiscalWatch';

afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

describe('liens directs', () => {
  it('stripParam retire un seul paramètre de l’adresse', () => {
    window.history.replaceState({}, '', '/?view=pilot&demo=1');
    stripParam('view');
    expect(window.location.search).toBe('?demo=1');
    stripParam('demo');
    expect(window.location.search).toBe('');
  });

  it('ajout rapide et écran demandés : traités une fois prêt, puis retirés de l’adresse', () => {
    window.history.replaceState({}, '', '/?action=quickadd&view=history&demo=1');
    const openView = vi.fn();
    const openQuickAdd = vi.fn();
    const { rerender } = renderHook(({ ready }) => useDeepLinks(ready, openView, openQuickAdd), { initialProps: { ready: false } });
    expect(openQuickAdd).not.toHaveBeenCalled();
    expect(openView).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(openQuickAdd).toHaveBeenCalledTimes(1);
    expect(openView).toHaveBeenCalledWith('history');
    expect(window.location.search).toBe('?demo=1');
  });

  it('écran inconnu de cette version : le lien reste dans l’adresse pour la version suivante', () => {
    window.history.replaceState({}, '', '/?view=ecran-futur');
    const openView = vi.fn();
    renderHook(() => useDeepLinks(true, openView, () => {}));
    expect(openView).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?view=ecran-futur');
  });

  describe('message du service worker (app déjà ouverte)', () => {
    const sw = new EventTarget();
    beforeEach(() => { Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true }); });
    afterEach(() => { cleanup(); Reflect.deleteProperty(navigator, 'serviceWorker'); });
    it('ouvre l’écran demandé, avec l’année de « Votre année »', () => {
      const openView = vi.fn();
      const onYear = vi.fn();
      window.addEventListener('pecule:open-year', onYear);
      renderHook(() => useDeepLinks(false, openView, () => {}));
      act(() => { sw.dispatchEvent(new MessageEvent('message', { data: { type: 'open-view', view: 'history', year: '2026' } })); });
      expect(openView).toHaveBeenCalledWith('history');
      expect(window.location.search).toBe('?year=2026');
      expect((onYear.mock.calls[0][0] as CustomEvent).detail).toBe(2026);
      act(() => { sw.dispatchEvent(new MessageEvent('message', { data: { type: 'open-view', view: 'inconnu' } })); });
      expect(openView).toHaveBeenCalledTimes(1);
      window.removeEventListener('pecule:open-year', onYear);
    });

    it('alerte de sécurité : ouvre Paramètres et la carte demandée (une carte inconnue est ignorée)', () => {
      const openView = vi.fn();
      const onSection = vi.fn();
      window.addEventListener(OPEN_SECTION_EVENT, onSection);
      renderHook(() => useDeepLinks(false, openView, () => {}));
      act(() => { sw.dispatchEvent(new MessageEvent('message', { data: { type: 'open-view', view: 'settings', section: 'account' } })); });
      expect(openView).toHaveBeenCalledWith('settings');
      expect(peekRequestedSection()).toBe('account');
      expect((onSection.mock.calls[0][0] as CustomEvent).detail).toBe('account');
      clearRequestedSection();
      act(() => { sw.dispatchEvent(new MessageEvent('message', { data: { type: 'open-view', view: 'settings', section: 'inconnue' } })); });
      expect(openView).toHaveBeenCalledTimes(2);
      expect(peekRequestedSection()).toBeNull();
      // La section n'est servie que pour Paramètres.
      act(() => { sw.dispatchEvent(new MessageEvent('message', { data: { type: 'open-view', view: 'history', section: 'data' } })); });
      expect(peekRequestedSection()).toBeNull();
      expect(onSection).toHaveBeenCalledTimes(1);
      window.removeEventListener(OPEN_SECTION_EVENT, onSection);
    });
  });
});

describe('écran courant', () => {
  it('le dernier écran enregistré remplace l’Accueil, et chaque changement est mémorisé', () => {
    const setLastView = vi.fn();
    const { result, rerender } = renderHook(({ last }) => useViewState(last, setLastView), { initialProps: { last: 'dashboard' } });
    rerender({ last: 'pilot' });
    expect(result.current.view).toBe('pilot');
    act(() => result.current.setView('journal'));
    expect(setLastView).toHaveBeenLastCalledWith('journal');
    // Ailleurs que sur l'Accueil, un nouveau `lastView` ne déplace pas l'utilisateur.
    rerender({ last: 'yield' });
    expect(result.current.view).toBe('journal');
  });

  it('un lien direct l’emporte sur le dernier écran enregistré', () => {
    const { result, rerender } = renderHook(({ last }) => useViewState(last, () => {}), { initialProps: { last: 'dashboard' } });
    act(() => result.current.openLinkedView('update'));
    act(() => result.current.setView('dashboard'));
    rerender({ last: 'pilot' });
    expect(result.current.view).toBe('dashboard');
  });
});

describe('indicateur de synchronisation', () => {
  it('libellé complet (barre latérale) ou court (en-tête mobile)', () => {
    const at = new Date(2026, 9, 20, 9, 5);
    expect(syncLabel({ kind: 'saved', at }, 'full')).toBe('Sur Drive à 09:05');
    expect(syncLabel({ kind: 'saved', at }, 'short')).toBe('09:05');
    expect(syncLabel({ kind: 'error' }, 'full')).toBe('Erreur sync');
    expect(syncLabel({ kind: 'error' }, 'short')).toBe('Erreur');
    expect(syncLabel({ kind: 'idle' }, 'full')).toBe('Synchronisé');
    expect(syncLabel({ kind: 'idle' }, 'short')).toBe('Sync');
    for (const variant of ['full', 'short'] as const) {
      expect(syncLabel({ kind: 'offline' }, variant)).toBe('Hors ligne');
      expect(syncLabel({ kind: 'saving' }, variant)).toBe('Sauvegarde...');
      expect(syncLabel({ kind: 'conflict' }, variant)).toBe('Conflit');
    }
  });

  it('envoi arrêté : ce qu’il faut faire, et l’infobulle dit que rien n’est envoyé', () => {
    expect(syncLabel({ kind: 'blocked', reason: 'session' }, 'full')).toBe('Reconnexion requise');
    expect(syncLabel({ kind: 'blocked', reason: 'session' }, 'short')).toBe('Reconnexion');
    expect(syncLabel({ kind: 'blocked', reason: 'outdated' }, 'full')).toBe('Mise à jour requise');
    expect(syncLabel({ kind: 'blocked', reason: 'outdated' }, 'short')).toBe('Mise à jour');
    expect(syncLabel({ kind: 'blocked', reason: 'load-failed' }, 'full')).toBe('Chargement échoué');
    expect(syncLabel({ kind: 'blocked', reason: 'load-failed' }, 'short')).toBe('Erreur');
    const at = new Date(2026, 9, 20, 9, 5, 7);
    expect(syncTitle({ kind: 'saved', at }, at)).toBe('Dernière écriture confirmée sur Drive : 09:05:07');
    expect(syncTitle({ kind: 'idle' }, null)).toBeUndefined();
    expect(syncTitle({ kind: 'blocked', reason: 'session' }, null)).toMatch(/rien n’est envoyé sur Drive/);
    expect(syncTitle({ kind: 'blocked', reason: 'session' }, at)).toMatch(/rien n’est envoyé sur Drive.*09:05:07/);
  });
});

const account = (id: string, extra: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name: id, institution: 'Banque', type: AccountType.LIVRET_A, totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [], ...extra,
});

describe('actions sur les données', () => {
  const setup = (doc: AppDoc) => {
    const setters = {
      setAccounts: vi.fn(), setParentalRestitution: vi.fn(), setActivePayslipId: vi.fn(), setFiscalConfig: vi.fn(),
      patchConfig: vi.fn(), exportData: vi.fn(),
    };
    const addToast = vi.fn<AddToast>(() => 'id');
    const dialog = { open: vi.fn<DialogApi['open']>(), confirm: vi.fn<DialogApi['confirm']>() };
    const hook = renderHook(({ d }) => useAccountActions(d, setters, addToast, dialog), { initialProps: { d: doc } });
    return { ...hook, setters, addToast, dialog };
  };

  it('identité stable d’un rendu à l’autre (les écrans mémoïsés ne sont pas re-rendus)', () => {
    const { result, rerender } = setup(emptyData());
    const first = result.current;
    rerender({ d: { ...emptyData(), accounts: [account('a')] } });
    expect(result.current).toBe(first);
  });

  it('supprimer un mouvement : confirmation, puis « Annuler » remet le solde d’avant', () => {
    const doc = { ...emptyData(), accounts: [account('a', { totalAmount: 150, ownedAmount: 150, movements: [{ id: 'm', date: '2026-10-01', amount: 50, label: 'Versement', type: 'IN' }] })] };
    const { result, setters, addToast, dialog } = setup(doc);
    act(() => result.current.deleteMovement('a', 'm'));
    const asked = dialog.open.mock.calls[0][0];
    expect(asked).toMatchObject({ title: 'Supprimer le mouvement', danger: true, confirmLabel: 'Supprimer' });
    act(() => asked.onConfirm!());
    const after = setters.setAccounts.mock.calls[0][0] as SavingsAccount[];
    expect(after[0]).toMatchObject({ totalAmount: 100, ownedAmount: 100, movements: [] });
    const toast = addToast.mock.calls[0][0] as { action: { label: string; onClick: () => void } };
    expect(toast.action.label).toBe('Annuler');
    act(() => toast.action.onClick());
    expect((setters.setAccounts.mock.calls[1][0] as SavingsAccount[])[0]).toMatchObject({ totalAmount: 150, ownedAmount: 150 });
  });

  it('ajout rapide : le message donne le montant et « Annuler » retire le mouvement', () => {
    const doc = { ...emptyData(), accounts: [account('a', { totalAmount: 100, ownedAmount: 100 })] };
    const { result, setters, addToast } = setup(doc);
    act(() => { result.current.quickAdd('a', 42, 'IN', 'Épargne du mois', '2026-10-01'); });
    expect((setters.setAccounts.mock.calls[0][0] as SavingsAccount[])[0]).toMatchObject({ totalAmount: 142, ownedAmount: 142 });
    const toast = addToast.mock.calls[0][0] as { message: string; kind: string; action: { label: string; onClick: () => void } };
    expect(toast.message).toMatch(/^Épargne du mois : \+42\s€ sur /);
    expect(toast).toMatchObject({ kind: 'success', action: { label: 'Annuler' } });
    act(() => toast.action.onClick());
    expect((setters.setAccounts.mock.calls[1][0] as SavingsAccount[])[0]).toMatchObject({ totalAmount: 100, ownedAmount: 100, movements: [] });
  });

  it('virement de paie coché : versement enregistré, sans « Annuler » (c’est la case qui l’annule)', () => {
    const doc = { ...emptyData(), accounts: [account('a', { totalAmount: 100, ownedAmount: 100 })] };
    const { result, setters, addToast } = setup(doc);
    let id: string | undefined;
    act(() => { id = result.current.recordPayDeposit('a', 30); });
    const after = (setters.setAccounts.mock.calls[0][0] as SavingsAccount[])[0];
    expect(after).toMatchObject({ totalAmount: 130, ownedAmount: 130 });
    expect(after.movements?.[0]).toMatchObject({ id, label: 'Virement de paie', amount: 30, type: 'IN' });
    const toast = addToast.mock.calls[0][0];
    expect(toast).toMatchObject({ kind: 'success' });
    expect(toast).not.toHaveProperty('action');
    // Décocher la ligne passe par cancelPayDeposit, qui retire exactement ce versement.
    act(() => result.current.cancelPayDeposit('a', id!));
    expect((setters.setAccounts.mock.calls[1][0] as SavingsAccount[])[0]).toMatchObject({ totalAmount: 100, ownedAmount: 100, movements: [] });
  });

  it('mouvement récurrent enregistré : « Annuler » le retire', () => {
    const doc = { ...emptyData(), accounts: [account('a', { totalAmount: 100, ownedAmount: 100 })] };
    const { result, setters, addToast } = setup(doc);
    act(() => result.current.recordRecurring({ id: 'r', accountId: 'a', amount: 20, type: 'IN', label: 'Virement auto', dayOfMonth: 5, active: true }, '2026-10-05'));
    const toast = addToast.mock.calls[0][0] as { action: { label: string; onClick: () => void } };
    expect(toast.action.label).toBe('Annuler');
    act(() => toast.action.onClick());
    expect((setters.setAccounts.mock.calls[1][0] as SavingsAccount[])[0]).toMatchObject({ totalAmount: 100, movements: [] });
  });

  it('annuler un changement de taux propose « Rétablir »', () => {
    const doc = { ...emptyData(), accounts: [account('a', { interestRate: 1.7, rateHistory: [{ date: '2026-08-01', rate: 2.4 }] })] };
    const { result, setters, addToast } = setup(doc);
    act(() => result.current.revertRate('a', '2026-08-01'));
    expect((setters.setAccounts.mock.calls[0][0] as SavingsAccount[])[0].interestRate).toBe(2.4);
    const toast = addToast.mock.calls[0][0] as { message: string; action: { label: string; onClick: () => void } };
    expect(toast).toMatchObject({ message: 'Changement de taux annulé', action: { label: 'Rétablir' } });
    act(() => toast.action.onClick());
    expect((setters.setAccounts.mock.calls[1][0] as SavingsAccount[])[0].interestRate).toBe(1.7);
  });

  it('renommer : jamais une restitution aux parents ; sinon une saisie, appliquée à l’état le plus récent', () => {
    const doc = { ...emptyData(), accounts: [account('a', { movements: [
      { id: 'm', date: '2026-10-01', amount: 5, label: 'Ancien', type: 'IN' },
      { id: 'r', date: '2027-01-01', amount: 5, label: 'Restitution aux parents', type: 'OUT', kind: 'parental', tag: 'restitution' },
    ] })] };
    const { result, setters, dialog } = setup(doc);
    act(() => result.current.renameMovement('a', 'r', 'Restitution aux parents'));
    expect(dialog.open).not.toHaveBeenCalled();
    act(() => result.current.renameMovement('a', 'm', 'Ancien'));
    act(() => dialog.open.mock.calls[0][0].onConfirm!('Nouveau'));
    const update = setters.setAccounts.mock.calls[0][0] as (prev: SavingsAccount[]) => SavingsAccount[];
    expect(update(doc.accounts)[0].movements![0].label).toBe('Nouveau');
  });

  it('repartir de zéro : toast avec « Annuler » qui remet l’ancienne date', () => {
    const doc = { ...emptyData(), config: { ...emptyData().config, trackingStartDate: '2026-01-01' } };
    const { result, setters, addToast } = setup(doc);
    act(() => result.current.setTrackingStart('2026-10-01'));
    expect(setters.patchConfig).toHaveBeenCalledWith({ trackingStartDate: '2026-10-01' });
    const toast = addToast.mock.calls[0][0] as { message: string; action: { onClick: () => void } };
    expect(toast.message).toBe('Suivi de l\'épargne reparti du 01/10/2026');
    act(() => toast.action.onClick());
    expect(setters.patchConfig).toHaveBeenLastCalledWith({ trackingStartDate: '2026-01-01' });
  });

  it('fiche de paie appliquée au Pilotage : brut annuel extrapolé, après confirmation', () => {
    const doc = { ...emptyData(), config: { ...emptyData().config, grossAnnual: 30000 } };
    const { result, setters, dialog } = setup(doc);
    act(() => result.current.applyPayslip({ id: 'p', fileName: 'f.pdf', extracted: { grossAmount: 2600, period: '2026-09' } } as never));
    const asked = dialog.open.mock.calls[0][0];
    expect(asked.message).toContain('31 200 €');
    act(() => asked.onConfirm!());
    expect(setters.patchConfig).toHaveBeenCalledWith({ grossAnnual: 31200 });
    expect(setters.setActivePayslipId).toHaveBeenCalledWith('p');
  });

  it('export : fichier téléchargé et rappel trimestriel reparti du jour', () => {
    const { result, setters } = setup(emptyData());
    act(() => result.current.exportNow());
    expect(setters.exportData).toHaveBeenCalled();
    expect(setters.patchConfig).toHaveBeenCalledWith({ lastExportAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('jalons vus et points de paie : sans doublon, 24 points au plus', () => {
    const doc = { ...emptyData(), config: { ...emptyData().config, milestonesSeen: ['a'], payReviewsDone: Array.from({ length: 24 }, (_, i) => `k${i}`) } };
    const { result, setters } = setup(doc);
    act(() => result.current.markMilestonesSeen(['a', 'b']));
    expect(setters.patchConfig).toHaveBeenCalledWith({ milestonesSeen: ['a', 'b'] });
    act(() => result.current.validatePayReview('k0'));
    const done = (setters.patchConfig.mock.calls[1][0] as { payReviewsDone: string[] }).payReviewsDone;
    expect(done).toHaveLength(24);
    expect(done[23]).toBe('k0');
  });
});

describe('fournisseurs : toasts et confirmation hors d’App', () => {
  it('un toast ou une confirmation ne re-rend pas le contenu', () => {
    let contentRenders = 0;
    const Content = () => {
      contentRenders++;
      const addToast = useAddToast();
      const dialog = useDialog();
      useMainUiShown(true);
      return <>
        <button onClick={() => addToast({ message: 'Bonjour' })}>toast</button>
        <button onClick={() => dialog.confirm('Vraiment ?', 'Explication', () => {}, true, 'Supprimer')}>confirmer</button>
      </>;
    };
    render(<UiProviders><Content /></UiProviders>);
    fireEvent.click(screen.getByText('toast'));
    expect(screen.getByText('Bonjour')).toBeTruthy();
    fireEvent.click(screen.getByText('confirmer'));
    expect(screen.getByRole('dialog', { name: 'Vraiment ?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeTruthy();
    expect(contentRenders).toBe(1);
  });

  it('jamais par-dessus le verrou ou la connexion : en file jusqu’à l’ouverture de l’app', () => {
    const Content = ({ shown }: { shown: boolean }) => {
      const addToast = useAddToast();
      const dialog = useDialog();
      useMainUiShown(shown);
      return <>
        <button onClick={() => addToast({ message: 'Supprimé : Livret A' })}>toast</button>
        <button onClick={() => dialog.confirm('Supprimer « Livret A »', '', () => {})}>confirmer</button>
      </>;
    };
    const { rerender } = render(<UiProviders><Content shown={false} /></UiProviders>);
    fireEvent.click(screen.getByText('toast'));
    fireEvent.click(screen.getByText('confirmer'));
    expect(screen.queryByText('Supprimé : Livret A')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<UiProviders><Content shown /></UiProviders>);
    expect(screen.getByText('Supprimé : Livret A')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Supprimer « Livret A »' })).toBeTruthy();
  });

  it('hors des fournisseurs : erreur claire', () => {
    expect(() => renderHook(() => useAddToast())).toThrow(/UiProviders/);
    expect(() => renderHook(() => useDialog())).toThrow(/UiProviders/);
    expect(() => renderHook(() => useMainUiShown(true))).toThrow(/UiProviders/);
  });
});

describe('écran mémoïsé', () => {
  const doc = emptyData();
  const data = { doc, geminiApiKey: '', patchConfig: () => {}, setActivePayslipId: () => {} } as unknown as ScreenData;
  const derived = {} as DerivedData;
  const actions = {} as AccountActions;
  const fiscalWatch = { proposals: [] } as unknown as FiscalWatch;
  const accountForm: AccountFormState = { editingAccount: undefined, setEditingAccount: () => {}, showForm: false, setShowForm: () => {} };
  const setView = () => {};
  const onSignedOut = () => {};

  it('un changement d’état d’App sans rapport (fenêtre, toast, sauvegarde) ne re-rend pas l’écran', () => {
    for (const k of Object.keys(renders)) delete renders[k];
    const Parent = () => {
      const [n, setN] = useState(0);
      const [d, setD] = useState(data);
      return <>
        <button onClick={() => setN(n + 1)}>etat-app {n}</button>
        <button onClick={() => setD({ ...data, doc: { ...doc } })}>donnees</button>
        <ScreenRouter view="dashboard" setView={setView} data={d} derived={derived} actions={actions} fiscalWatch={fiscalWatch} accountForm={accountForm} onSignedOutEverywhere={onSignedOut} />
      </>;
    };
    render(<UiProviders><Parent /></UiProviders>);
    expect(renders.Dashboard).toBe(1);
    fireEvent.click(screen.getByText(/etat-app/));
    fireEvent.click(screen.getByText(/etat-app/));
    expect(renders.Dashboard).toBe(1);
    fireEvent.click(screen.getByText('donnees'));
    expect(renders.Dashboard).toBe(2);
  });
});
