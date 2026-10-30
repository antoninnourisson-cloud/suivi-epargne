// L'écran courant (un seul monté à la fois), chargé à la demande. Composant mémoïsé : il ne
// se re-rend que si le document, l'écran ou ce qui en dérive change, jamais pour un toast,
// une fenêtre, une bannière ou l'indicateur de sauvegarde (voir les props stables d'App).
import { memo, Suspense, useCallback, useMemo, useState } from 'react';
import type { PortfolioData } from '../hooks/usePortfolioData';
import { payChecklistOf } from '../lib/payRecords';
import { withSavedPayslip } from '../components/payslips/usePayslipImport';
import type { PayRitualProps } from '../components/pilot/PayReceivedSheet';
import type { FiscalWatch } from '../hooks/useFiscalWatch';
import type { SavingsAccount } from '../types';
import { isView, type View } from '../navigation';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { openSettingsSection } from '../components/settings/sections';
import {
  AccountUpdate, AccountsView, Agenda, AskPeculeEntry, AssistantPilot, CloudBackupPanel, Dashboard, Donations, DriveBackupsPanel,
  FiscalWatchCard, History, Journal, Lazy, MotivationSettings, ParentalShare, Payslips, ServerSecurityPanel,
  SetAsideVersionsPanel, Settings, ShareTargetHost, Simulator, SoloPlanCard, StatementImport, Subscriptions, TaxNoticePanel, TaxReturnHelper,
  TransferManager, ViewLoader, Yield, YearClosingCard,
} from './screens';
import type { DerivedData } from './useDerivedData';
import { lepStillEligible } from '../lib/idleCash';
import { localTodayISO } from '../lib/dates';
import type { AccountActions } from './useAccountActions';
import { usePayRaise } from './usePayRaise';
import { useAddToast, useDialog } from './UiProviders';

/** Ce que les écrans lisent et modifient : le document et des fonctions stables. */
export const useScreenData = (data: PortfolioData) => {
  const {
    doc, geminiApiKey, setGeminiApiKey, setAccounts, setExpenses, setPayslips, setRecurringMovements, setSubscriptions,
    setDonations, setActivePayslipId, setFiscalConfig, updateWorkBenefits, patchConfig,
    importData, recoverSetAside, listDriveBackups,
    restoreDriveBackup, listSetAsideVersions, currentData,
  } = data;
  return useMemo(() => ({
    doc, geminiApiKey, setGeminiApiKey, setAccounts, setExpenses, setPayslips, setRecurringMovements, setSubscriptions,
    setDonations, setActivePayslipId, setFiscalConfig, updateWorkBenefits, patchConfig,
    importData, recoverSetAside, listDriveBackups,
    restoreDriveBackup, listSetAsideVersions, currentData,
  }), [doc, geminiApiKey, setGeminiApiKey, setAccounts, setExpenses, setPayslips, setRecurringMovements, setSubscriptions,
    setDonations, setActivePayslipId, setFiscalConfig, updateWorkBenefits, patchConfig,
    importData, recoverSetAside, listDriveBackups,
    restoreDriveBackup, listSetAsideVersions, currentData]);
};
export type ScreenData = ReturnType<typeof useScreenData>;

/** Formulaire de compte (écran Mes comptes), ouvrable depuis l'Accueil et Actualiser. */
export interface AccountFormState {
  editingAccount: SavingsAccount | undefined;
  setEditingAccount: (a: SavingsAccount | undefined) => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
}
export const useAccountForm = (): AccountFormState => {
  const [editingAccount, setEditingAccount] = useState<SavingsAccount | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  return useMemo(() => ({ editingAccount, setEditingAccount, showForm, setShowForm }), [editingAccount, showForm]);
};

interface ScreenRouterProps {
  view: View;
  setView: (v: View) => void;
  data: ScreenData;
  derived: DerivedData;
  actions: AccountActions;
  fiscalWatch: FiscalWatch;
  accountForm: AccountFormState;
  /** « Déconnecter tous les appareils » (Paramètres, sécurité). */
  onSignedOutEverywhere: () => void;
  /** « Se déconnecter » (Paramètres) : toujours confirmé (`alwaysConfirm`). */
  onRequestLogout: (alwaysConfirm: boolean) => void;
  /** Ouvre l'ajout rapide d'un mouvement (fonction stable d'App). */
  onQuickAdd: () => void;
  /** « Partager vers Pécule » : valeur de `?partage=` (sinon `null`), données prêtes, fin du partage. */
  shareMarker: string | null;
  shareReady: boolean;
  onShareDone: () => void;
}

export const ScreenRouter = memo(function ScreenRouter({ view, setView, data, derived, actions, fiscalWatch, accountForm, onSignedOutEverywhere, onRequestLogout, onQuickAdd, shareMarker, shareReady, onShareDone }: ScreenRouterProps) {
  const addToast = useAddToast();
  const dialog = useDialog();
  const { doc } = data;
  const c = doc.config;
  // Paie du mois d'épargne en cours, sous sa forme de liste à cocher (lib/payRecords) :
  // carte « Ma paie » du Pilotage, routine de l'Accueil.
  const payCalendar = useMemo(() => ({ payslips: doc.payslips, pays: doc.pays }), [doc.payslips, doc.pays]);
  const payChecklist = payChecklistOf(doc);
  const { editingAccount, setEditingAccount, showForm, setShowForm } = accountForm;
  const raise = usePayRaise(doc, data, addToast);
  // « Lire un relevé » (Actualiser, fiche d'un compte) : une seule fenêtre, au-dessus de l'écran.
  const [statementFor, setStatementFor] = useState<{ accountId?: string } | null>(null);
  // Fiche de paie partagée vers Pécule, en attente de l'écran des fiches qui la prend.
  const [sharedPayslip, setSharedPayslip] = useState<File | null>(null);
  const sharedPayslipTaken = useCallback(() => setSharedPayslip(null), []);

  const openNewAccount = () => { setView('accounts'); setEditingAccount(undefined); setShowForm(true); };
  const openSettings = (section: Parameters<typeof openSettingsSection>[0]) => { openSettingsSection(section); setView('settings'); };
  const saveAccount = (acc: SavingsAccount) => {
    if (!actions.saveAccount(acc)) return;
    setShowForm(false);
    setEditingAccount(undefined);
  };
  // Le rituel « J'ai reçu ma paie » (carte « Ma paie » du Pilotage) : une fiche de paie relue
  // sur place rejoint la liste des fiches, comme depuis l'écran Fiches de paie.
  const payRitual: PayRitualProps = {
    doc, geminiApiKey: data.geminiApiKey, pickerApiKey: c.pickerApiKey ?? '',
    onRecordPay: actions.recordPay, onDeletePay: actions.deletePay, onValidateReview: actions.validatePayReview,
    onSavePayslip: (record, replaced) => {
      data.setPayslips(prev => withSavedPayslip(prev, record, replaced));
      if (doc.activePayslipId && replaced.has(doc.activePayslipId)) actions.clearActivePayslip();
    },
    onOpenKeys: () => openSettings('keys'),
  };
  const fiscalWatchCard = (compact: boolean) => <Lazy><FiscalWatchCard compact={compact} watch={fiscalWatch} onApply={actions.applyFiscalProposal} /></Lazy>;

  return (
    <ErrorBoundary resetKey={view}>
      <Suspense fallback={<ViewLoader />}>
        {view === 'dashboard' && fiscalWatch.proposals.length > 0 && <div className="mb-6">{fiscalWatchCard(true)}</div>}
        {view === 'dashboard' && <Dashboard
          accounts={doc.accounts} history={doc.history} fiscalConfig={doc.fiscalConfig} onDeleteAccount={actions.deleteAccount}
          monthPlan={derived.monthPlan} monthGoal={derived.monthGoal} monthlyPay={derived.monthlyPay} paydayDay={c.paydayDay} trackingStartDate={c.trackingStartDate}
          payRaise={raise.payRaise} onAcceptPayRaise={raise.accept} onDismissPayRaise={raise.dismiss}
          subscriptions={doc.subscriptions} onUpdateFiscalConfig={data.setFiscalConfig} onUpdateAccounts={data.setAccounts}
          onOpenSettings={section => openSettings(section ?? 'fiscal')} recurringMovements={doc.recurringMovements} onRecordRecurring={actions.recordRecurring}
          // Depuis l'Accueil, le seul lien vers les Paramètres est « Importer mon avis » (LEP) :
          // il ouvre directement la carte de l'avis d'imposition.
          onNavigate={v => (v === 'settings' ? openSettings('tax-notice') : setView(v))}
          onAddAccount={openNewAccount} lastExportAt={c.lastExportAt} onExport={actions.exportNow}
          emergency={derived.emergency} onSetEmergencyMonths={m => data.patchConfig({ emergencyMonths: m })}
          agendaNext={derived.agendaNext} lepTimeline={derived.lepTimeline} taxReturnAlert={derived.taxReturnAlert}
          payslips={doc.payslips} gamification={c.gamification} goodMonthThreshold={c.goodMonthThreshold}
          milestonesSeen={c.milestonesSeen} payReviewsDone={c.payReviewsDone} rfrByYear={c.rfrByYear}
          restitutionDoneOn={doc.parentalRestitution?.done?.date} restitutionPlannedDate={doc.parentalRestitution?.plannedDate}
          yearClosing={derived.yearClosing} payChecklist={payChecklist} pays={doc.pays}
          askSlot={<Lazy><AskPeculeEntry data={derived.fullData} geminiApiKey={data.geminiApiKey} taxEstimate={derived.taxEstimate} monthPlan={derived.monthPlan} onOpenSettings={openSettings} /></Lazy>}
          onMarkMilestonesSeen={actions.markMilestonesSeen} onValidatePayReview={actions.validatePayReview} />}

        {view === 'pilot' && <AssistantPilot
          accounts={doc.accounts} expenses={doc.expenses} onUpdateExpenses={data.setExpenses}
          config={c} onPatchConfig={data.patchConfig}
          fiscalConfig={doc.fiscalConfig} workBenefits={doc.workBenefits}
          activePayslip={derived.activePayslip} onClearActivePayslip={actions.clearActivePayslip}
          subscriptions={doc.subscriptions} onOpenSubscriptions={() => setView('subscriptions')}
          payChecklist={payChecklist} onPayLineCheck={actions.checkPayLine} onPayLineUncheck={actions.uncheckPayLine} onPayPlanReset={actions.resetPayPlan}
          payCalendar={payCalendar} payRitual={payRitual}
          />}

        {view === 'transfers' && <TransferManager accounts={doc.accounts} onCommit={actions.commit} recurringMovements={doc.recurringMovements} onUpdateRecurring={data.setRecurringMovements} onQuickAdd={onQuickAdd} />}
        {view === 'update' && <AccountUpdate accounts={doc.accounts} onCommit={actions.commit} onAddAccount={openNewAccount}
          onReadStatement={() => setStatementFor({})} />}
        {statementFor && <Lazy><StatementImport accounts={doc.accounts} geminiApiKey={data.geminiApiKey} preferredAccountId={statementFor.accountId}
          onClose={() => setStatementFor(null)} onImport={actions.importStatement} onOpenKeys={() => openSettings('keys')} /></Lazy>}

        {view === 'yield' && <Yield accounts={doc.accounts} hypotheses={derived.projectionHypotheses} fiscalConfig={doc.fiscalConfig} monthPlan={derived.monthPlan} savingsSplit={c.savingsSplit} restitutionInMonths={derived.restitutionInMonths}
          taxableIncome={derived.taxEstimate?.taxableIncome} retirementCeiling={c.retirementCeiling}
          monthlySpending={derived.emergency?.monthlySpending} lepEligible={lepStillEligible(derived.lepTimeline)}
          onSaveRetirementCeiling={retirementCeiling => data.patchConfig({ retirementCeiling })}
          onConfirmBalance={acc => actions.saveAccount({ ...acc, balanceCheckedAt: localTodayISO() })} />}
        {view === 'simulator' && <Simulator accounts={doc.accounts} hypotheses={derived.projectionHypotheses} fiscalConfig={doc.fiscalConfig} monthPlan={derived.monthPlan} savingsSplit={c.savingsSplit} paydayDay={c.paydayDay} payslips={doc.payslips} trackingStartDate={c.trackingStartDate} parentalRestitution={doc.parentalRestitution} />}
        {view === 'history' && <History history={doc.history} expensesHistory={doc.expensesHistory} reviewData={derived.fullData}
          closingSlot={doc.accounts.length > 0 ? <Lazy><YearClosingCard data={derived.fullData} onPatchConfig={data.patchConfig}
            onUpdateAccounts={data.setAccounts} onUpdateFiscalConfig={data.setFiscalConfig}
            onNavigate={v => { if (v === 'settings') openSettingsSection('fiscal'); setView(v); }}
            getArchiveData={data.currentData} confirm={dialog.confirm} /></Lazy> : undefined} />}
        {view === 'journal' && <Journal
          accounts={doc.accounts} restitution={doc.parentalRestitution} onDeleteMovement={actions.deleteMovement}
          trackingStartDate={c.trackingStartDate} onSetTrackingStart={actions.setTrackingStart}
          onToggleAdjustment={actions.toggleAdjustment} onRemoveCancelling={actions.removeCancelling} onRevertRate={actions.revertRate} />}
        {view === 'agenda' && <Agenda data={derived.fullData} onOpen={v => { if (!isView(v)) return; if (v === 'settings') openSettingsSection('fiscal'); setView(v); }} />}
        {view === 'parental' && <ParentalShare
          accounts={doc.accounts} restitution={doc.parentalRestitution} monthPlan={derived.monthPlan} hasCustomSplit={!!c.savingsSplit?.length}
          onPlanRestitution={actions.planRestitution} onRestitute={actions.restitute} onUndoRestitution={actions.undoRestitution}
          onOpenAccounts={() => setView('accounts')}
          soloPlanSlot={doc.parentalRestitution?.plannedDate && !doc.parentalRestitution.done
            ? <Lazy><SoloPlanCard accounts={doc.accounts} hypotheses={derived.projectionHypotheses} fiscalConfig={doc.fiscalConfig} monthPlan={derived.monthPlan} restitutionISO={doc.parentalRestitution.plannedDate} split={c.savingsSplit} emergencyTarget={derived.emergency?.target} cashBuffer={derived.emergency?.cashBuffer} /></Lazy>
            : undefined} />}
        {view === 'donations' && <Donations donations={doc.donations} onUpdate={data.setDonations} pickerApiKey={c.pickerApiKey ?? ''} taxEstimates={derived.taxEstimates} ceiling75={doc.fiscalConfig.donation75Ceiling}
          taxHelper={<Lazy><TaxReturnHelper data={derived.fullData} taxEstimates={derived.taxEstimates} allowanceRate={doc.fiscalConfig.standardAllowance} allowanceCap={doc.fiscalConfig.standardAllowanceCap} ceiling75={doc.fiscalConfig.donation75Ceiling} /></Lazy>} />}
        {view === 'subscriptions' && <Subscriptions subscriptions={doc.subscriptions} onUpdate={data.setSubscriptions} monthlyPay={derived.monthlyPay} />}
        {view === 'payslips' && <Payslips payslips={doc.payslips} onUpdatePayslips={data.setPayslips} geminiApiKey={data.geminiApiKey} pickerApiKey={c.pickerApiKey ?? ''} onApplyToPilotage={actions.applyPayslip} activePayslipId={doc.activePayslipId} onClearActivePayslip={actions.clearActivePayslip}
          onOpenKeys={() => { openSettingsSection('keys'); setView('settings'); }}
          sharedFile={sharedPayslip} onSharedFileTaken={sharedPayslipTaken} onPayslipSaved={actions.attachPayslip} />}
        {shareMarker !== null && <Lazy><ShareTargetHost marker={shareMarker} ready={shareReady} data={data} onImportStatement={actions.importStatement}
          onPayslip={file => { setSharedPayslip(file); setView('payslips'); }} onOpenKeys={() => openSettings('keys')} onDone={onShareDone} /></Lazy>}

        {view === 'settings' && <Settings
          payslips={doc.payslips}
          notificationPrefs={c.notificationPrefs}
          onChangeNotificationPrefs={p => data.patchConfig({ notificationPrefs: p })}
          hasParental={derived.hasParental}
          config={doc.fiscalConfig}
          workBenefits={doc.workBenefits}
          geminiApiKey={data.geminiApiKey}
          pickerApiKey={c.pickerApiKey ?? ''}
          onExport={actions.exportNow}
          onImport={data.importData}
          onUndoImport={data.recoverSetAside}
          backupSlot={<Lazy>
            <DriveBackupsPanel list={data.listDriveBackups} restore={data.restoreDriveBackup} undo={data.recoverSetAside} confirm={(t, m, ok, label) => dialog.confirm(t, m, ok, true, label)} />
            <CloudBackupPanel getData={data.currentData} onImport={data.importData} undo={data.recoverSetAside} confirm={dialog.confirm} />
            <SetAsideVersionsPanel list={data.listSetAsideVersions} recover={data.recoverSetAside} confirm={dialog.confirm} />
          </Lazy>}
          fiscalWatchSlot={fiscalWatchCard(false)}
          taxNoticeSlot={<Lazy><TaxNoticePanel geminiApiKey={data.geminiApiKey} rfrByYear={c.rfrByYear || {}} householdParts={doc.fiscalConfig.lepHouseholdParts}
            onSave={(y, v) => data.patchConfig({ rfrByYear: { ...(c.rfrByYear || {}), [String(y)]: v } })}
            onSetParts={parts => data.setFiscalConfig(prev => ({ ...prev, lepHouseholdParts: parts }))} /></Lazy>}
          securitySlot={<Lazy><ServerSecurityPanel discreet={!!c.discreetNotifications} onToggleDiscreet={v => data.patchConfig({ discreetNotifications: v || undefined })} confirm={dialog.confirm}
            onSignedOutEverywhere={onSignedOutEverywhere} /></Lazy>}
          motivationSlot={<Lazy><MotivationSettings gamification={c.gamification} goodMonthThreshold={c.goodMonthThreshold} onChange={patch => data.patchConfig(patch)} /></Lazy>}
          paydayDay={c.paydayDay}
          onOpenPayday={() => setView('pilot')}
          // Champ par champ, à partir de l'état le plus récent : une saisie ne défait jamais ce
          // qui a changé entre-temps (veille fiscale, avis, import).
          onUpdateFiscal={update => data.setFiscalConfig(update)}
          onUpdateBenefits={data.updateWorkBenefits}
          onSaveGeminiKey={data.setGeminiApiKey}
          onSavePickerKey={key => data.patchConfig({ pickerApiKey: key })}
          onRequestLogout={() => onRequestLogout(true)} />}

        {view === 'accounts' && <AccountsView
          accounts={doc.accounts} fiscalConfig={doc.fiscalConfig} onUpdateAccounts={data.setAccounts}
          setView={setView} editingAccount={editingAccount} setEditingAccount={setEditingAccount}
          showForm={showForm} setShowForm={setShowForm}
          handleSaveAccount={saveAccount} handleDeleteAccount={actions.deleteAccount}
          handleDeleteMovement={actions.deleteMovement} handleRenameMovement={actions.renameMovement}
          hasParental={derived.hasParental} onReadStatement={accountId => setStatementFor({ accountId })} />}
      </Suspense>
    </ErrorBoundary>
  );
});
