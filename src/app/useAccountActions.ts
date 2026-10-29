// Actions des écrans sur les données : confirmation, toast, annulation, écriture. Tout ce qui
// change les soldes passe par les commandes de src/lib/commands (pures et testées : elles
// appliquent elles-mêmes les règles du capital des parents et préparent l'annulation exacte).
// Ici, seulement l'interface autour.
//
// Les actions ont une identité stable (elles lisent l'état le plus récent dans une réf) : les
// écrans mémoïsés ne sont pas re-rendus quand seul App change.
import { useMemo, useRef } from 'react';
import type { AppDoc, PayslipRecord, RecurringMovement, SavingsAccount } from '../types';
import type { PortfolioData } from '../hooks/usePortfolioData';
import type { FiscalProposal } from '../lib/fiscalWatch';
import type { CancellingGroup } from '../lib/accountOps';
import { isRestitutionMovement } from '../lib/accountOps';
import { localTodayISO, parseISODate } from '../lib/dates';
import { plainEUR } from '../lib/format';
import {
  type CommandError, type CommandOk, type CommandPatch, type CommandState,
  saveAccount, deleteAccount, quickAdd, planMovementDeletion, deleteMovement, cancelDeposit, removeCancellingMovements,
  recordRestitution, undoRestitution, revertRateChange, renameMovement, toggleMovementAdjustment,
  importStatement, type StatementImportItem,
} from '../lib/commands';
import type { AddToast, DialogApi } from './UiProviders';

type Setters = Pick<PortfolioData,
  'setAccounts' | 'setParentalRestitution' | 'setActivePayslipId' | 'setFiscalConfig' | 'patchConfig' | 'exportData'>;

export const useAccountActions = (doc: AppDoc, setters: Setters, addToast: AddToast, dialog: DialogApi) => {
  // État le plus récent : une confirmation ou une annulation (toast) s'applique à l'état du
  // moment, pas à celui du rendu qui l'a créée.
  const docRef = useRef(doc);
  docRef.current = doc;
  const commandStateRef = useRef<CommandState>({ accounts: doc.accounts, parentalRestitution: doc.parentalRestitution });
  commandStateRef.current = { accounts: doc.accounts, parentalRestitution: doc.parentalRestitution };
  const deps = useRef({ setters, addToast, dialog });
  deps.current = { setters, addToast, dialog };

  return useMemo(() => {
    const s = () => deps.current.setters;
    const toast: AddToast = t => deps.current.addToast(t);
    const commit = (patch: CommandPatch) => {
      commandStateRef.current = { ...commandStateRef.current, ...patch };
      if (patch.accounts) s().setAccounts(patch.accounts);
      if ('parentalRestitution' in patch) s().setParentalRestitution(patch.parentalRestitution);
    };
    const undoAction = (r: CommandOk, label = 'Annuler') => ({ label, onClick: () => commit(r.undo(commandStateRef.current)) });
    // Compte ou mouvement disparu entre-temps : rien à signaler.
    const showCommandError = (e: CommandError) => { if (e.code !== 'not-found') toast({ message: e.error, kind: 'error' }); };

    /** Ajout rapide ; renvoie l'id du mouvement créé (la liste des virements de paie peut l'annuler). */
    const addMovement = (
      accountId: string, amount: number, type: 'IN' | 'OUT', label: string, date: string,
      { undoable = true }: { undoable?: boolean } = {},
    ): string | undefined => {
      // Garde-fou dans la commande : un retrait ne peut pas entamer la part des parents.
      const r = quickAdd(commandStateRef.current, { accountId, amount, type, label, date });
      if (!r.ok) { showCommandError(r); return undefined; }
      commit(r.next);
      // « Annuler » comme pour toutes les autres opérations : une faute de frappe sur le
      // montant (affiché dans le message) se corrige sans aller chercher le mouvement.
      toast({ message: r.message, kind: 'success', ...(undoable ? { action: undoAction(r) } : {}) });
      return r.movementId;
    };

    return {
      commit,
      quickAdd: (accountId: string, amount: number, type: 'IN' | 'OUT', label: string, date: string) =>
        addMovement(accountId, amount, type, label, date),
      // Pas de « Annuler » ici : la liste des virements de paie garde l'id du mouvement pour
      // cocher la ligne, et c'est en la décochant qu'on annule (sinon la ligne resterait
      // « faite » pour un versement disparu).
      recordPayDeposit: (accountId: string, amount: number) =>
        addMovement(accountId, amount, 'IN', 'Virement de paie', localTodayISO(), { undoable: false }),
      recordRecurring: (r: RecurringMovement, date: string) => { addMovement(r.accountId, r.amount, r.type, r.label, date); },

      /** Enregistre un compte ; false si la commande le refuse (le formulaire reste ouvert). */
      saveAccount: (acc: SavingsAccount): boolean => {
        const r = saveAccount(commandStateRef.current, { account: acc, today: localTodayISO() });
        if (!r.ok) { showCommandError(r); return false; }
        commit(r.next);
        return true;
      },

      deleteAccount: (acc: SavingsAccount) => {
        const isEmpty = acc.totalAmount === 0;
        deps.current.dialog.open({
          kind: 'confirm', danger: true, confirmLabel: 'Supprimer',
          title: `Supprimer « ${acc.name} »`,
          message: isEmpty ? 'Ce compte est vide, il sera supprimé.' : 'Ce compte contient encore un solde. Supprimer définitivement ?',
          onConfirm: () => {
            // L'annulation remet le compte à sa place d'origine (voir deleteAccount).
            const r = deleteAccount(commandStateRef.current, { accountId: acc.id });
            if (!r.ok) { showCommandError(r); return; }
            commit(r.next);
            toast({ message: r.message, action: undoAction(r) });
          },
        });
      },

      deleteMovement: (accountId: string, movementId: string) => {
        const plan = planMovementDeletion(commandStateRef.current.accounts, accountId, movementId);
        if (!plan.ok) { showCommandError(plan); return; }
        const { movement, legs, isTransfer } = plan;
        deps.current.dialog.open({
          kind: 'confirm', danger: true, confirmLabel: 'Supprimer',
          title: isTransfer ? 'Supprimer le virement' : 'Supprimer le mouvement',
          message: isTransfer
            ? `« ${movement.label} » est un virement interne : les ${legs.length} lignes liées seront supprimées ensemble.`
            : `« ${movement.label} » sera supprimé.`,
          onConfirm: () => {
            const r = deleteMovement(commandStateRef.current, { accountId, movementId });
            if (!r.ok) { showCommandError(r); return; }
            commit(r.next);
            toast({ message: r.message, action: undoAction(r) });
          },
        });
      },

      renameMovement: (accountId: string, movementId: string, currentLabel: string) => {
        const m = commandStateRef.current.accounts.find(a => a.id === accountId)?.movements.find(x => x.id === movementId);
        if (m && isRestitutionMovement(m)) return;
        deps.current.dialog.open({
          kind: 'prompt', title: 'Renommer le mouvement', defaultValue: currentLabel, confirmLabel: 'Renommer',
          onConfirm: newLabel => { if (newLabel) s().setAccounts(prev => renameMovement(prev, accountId, movementId, newLabel)); },
        });
      },

      toggleAdjustment: (accountId: string, movementId: string) =>
        s().setAccounts(prev => toggleMovementAdjustment(prev, accountId, movementId)),

      /** Annule un changement de taux (tout le groupe Livret A / LDDS), avec « Rétablir ». */
      revertRate: (accountId: string, entryDate: string) => {
        const r = revertRateChange(commandStateRef.current, { accountId, entryDate });
        if (!r.ok) { showCommandError(r); return; }
        commit(r.next);
        toast({ message: r.message, kind: 'success', action: undoAction(r, 'Rétablir') });
      },

      removeCancelling: (groups: CancellingGroup[]) => {
        // Mouvements qui s'annulent : leur somme est nulle, les soldes ne bougent pas.
        const r = removeCancellingMovements(commandStateRef.current, groups);
        if (!r.ok) { showCommandError(r); return; }
        commit(r.next);
        toast({ message: r.message, kind: 'success', action: undoAction(r) });
      },

      /** Annule un versement enregistré depuis la liste des virements de paie. */
      cancelPayDeposit: (accountId: string, movementId: string) => {
        const r = cancelDeposit(commandStateRef.current, { accountId, movementId });
        if (!r.ok) { showCommandError(r); return; }
        commit(r.next);
      },

      // --- RESTITUTION DU CAPITAL PARENTAL (lib/commands/restitution) ---
      planRestitution: (date: string | undefined) => s().setParentalRestitution(prev => ({ ...prev, plannedDate: date })),
      restitute: (date: string) => {
        const r = recordRestitution(commandStateRef.current, { date });
        if (!r.ok) { showCommandError(r); return; }
        commit(r.next);
        toast({ message: r.message, kind: 'success', action: undoAction(r) });
      },
      // Annulation après coup (confirmée dans RestitutionPanel) ; « Rétablir » la rejoue à l'identique.
      undoRestitution: () => {
        const r = undoRestitution(commandStateRef.current);
        if (!r.ok) return;
        commit(r.next);
        toast({ message: r.message, kind: 'success', action: undoAction(r, 'Rétablir') });
      },

      /** « Repartir de zéro » dans le Journal, annulable. */
      setTrackingStart: (date: string | undefined) => {
        const prev = docRef.current.config.trackingStartDate;
        s().patchConfig({ trackingStartDate: date });
        toast({
          message: date ? `Suivi de l'épargne reparti du ${parseISODate(date).toLocaleDateString('fr-FR')}` : 'Point de départ retiré',
          kind: 'success', action: { label: 'Annuler', onClick: () => s().patchConfig({ trackingStartDate: prev }) },
        });
      },

      // Bascule le Pilotage sur les chiffres EXACTS de cette fiche de paie (brut, charges,
      // impôt réellement prélevé...), à la place de la formule théorique. Le brut annuel est
      // extrapolé (mois × 12) ; le reste n'est pas recalculé : ce sont les montants de la fiche.
      applyPayslip: (p: PayslipRecord) => {
        if (p.extracted.grossAmount === undefined) return;
        const estimate = Math.round(p.extracted.grossAmount * 12);
        deps.current.dialog.open({
          kind: 'confirm', confirmLabel: 'Appliquer',
          title: 'Utiliser les chiffres réels de cette fiche',
          message: `Le Pilotage budgétaire affichera les montants exacts de la fiche de ${p.extracted.period || 'cette fiche'} (brut, charges, impôt réellement prélevé...) à la place de la formule théorique. Le brut annuel sera aussi mis à jour (${plainEUR(estimate)}, extrapolé), à la place de ${plainEUR(docRef.current.config.grossAnnual)} actuellement.`,
          onConfirm: () => {
            s().patchConfig({ grossAnnual: estimate });
            s().setActivePayslipId(p.id);
            toast({ message: 'Pilotage basé sur votre fiche de paie réelle', kind: 'success' });
          },
        });
      },
      clearActivePayslip: () => {
        s().setActivePayslipId(undefined);
        toast({ message: 'Retour à l\'estimation théorique', kind: 'success' });
      },

      /** Proposition de la veille fiscale acceptée. */
      applyFiscalProposal: (p: FiscalProposal) => {
        const { fiscalConfig, accounts } = docRef.current;
        const next = p.apply({ fiscal: fiscalConfig, accounts });
        s().setFiscalConfig(next.fiscal);
        if (next.accounts !== accounts) s().setAccounts(next.accounts);
        toast({ message: `${p.label} mis à jour`, kind: 'success' });
      },

      /**
       * « Lire un relevé » validé : soldes et opérations enregistrés en une fois, avec
       * « Annuler ». Renvoie le refus de la commande (affiché dans la fenêtre), sinon `null`.
       */
      importStatement: (items: StatementImportItem[]): string | null => {
        const r = importStatement(commandStateRef.current, { items });
        if (!r.ok) return r.code === 'not-found' ? null : r.error;
        commit(r.next);
        toast({ message: r.message, kind: 'success', action: undoAction(r) });
        return null;
      },

      /** Copie téléchargée : le rappel trimestriel repart de ce jour. */
      exportNow: () => {
        s().exportData();
        s().patchConfig({ lastExportAt: localTodayISO() });
      },

      // Motivation : jalons déjà montrés et points de paie validés (synchronisés sur Drive).
      markMilestonesSeen: (ids: string[]) =>
        s().patchConfig({ milestonesSeen: [...new Set([...(docRef.current.config.milestonesSeen ?? []), ...ids])] }),
      // Les 24 derniers suffisent : un point de paie ne revient jamais sur une paie plus ancienne.
      validatePayReview: (key: string) =>
        s().patchConfig({ payReviewsDone: [...(docRef.current.config.payReviewsDone ?? []).filter(k => k !== key), key].slice(-24) }),
    };
  }, []);
};

export type AccountActions = ReturnType<typeof useAccountActions>;
