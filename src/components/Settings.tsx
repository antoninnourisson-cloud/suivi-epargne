// ================================================
// FILE: src/components/Settings.tsx
// Écran Paramètres : une liste courte de cartes repliables, regroupées par thème. Chaque
// carte résume son état sur une ligne ; les cartes ouvertes sont mémorisées sur cet
// appareil, et un lien peut en ouvrir une (voir settings/sections).
// ================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiscalConfig, PayslipRecord, WorkBenefits } from '../types';
import {
  AlertTriangle, Download, Upload, Database, KeyRound, Fingerprint, Building2, Scale, FileSearch, Radar, Sprout, Bell,
  Smartphone, Info, Save, Palette, HardDrive, LogOut,
} from 'lucide-react';
import { DisplaySection, displaySummary } from './settings/DisplaySection';
import { useTheme } from '../hooks/useTheme';
import { useDiscreetMode } from '../hooks/useDiscreetMode';
import { NotificationSettings } from './NotificationSettings';
import { useToast } from './Toast';
import { GeminiModelField } from './SettingsPanels';
import { isBackendEnabled } from '../services/backendService';
import { LATEST_VERSION } from '../changelog';
import { Button, PageHeader, TextField } from './ui';
import { SettingsCard, Hint, Notice } from './settings/SettingsCard';
import { BenefitsFields, FiscalFields, benefitsSummary, fiscalSummary } from './settings/SalarySections';
import { LockSection } from './settings/LockSection';
import { AboutSection } from './settings/AboutSection';
import { DeviceSection } from './settings/DeviceSection';
import {
  OPEN_SECTION_EVENT, clearRequestedSection, isSettingsSection, peekRequestedSection, readOpenSections, sectionAnchor,
  writeOpenSections, type SettingsSection,
} from './settings/sections';

interface SettingsProps {
  payslips?: PayslipRecord[];
  config: FiscalConfig;
  workBenefits: WorkBenefits;
  geminiApiKey: string;
  pickerApiKey: string;
  /** Modifications appliquées à l'état le plus récent (seuls les champs touchés changent). */
  onUpdateFiscal: (update: (prev: FiscalConfig) => FiscalConfig) => void;
  onUpdateBenefits: (update: (prev: WorkBenefits) => WorkBenefits) => void;
  onSaveGeminiKey: (key: string) => void;
  onSavePickerKey: (key: string) => void;
  onExport: () => void;
  /** `undoId` : version mise de côté juste avant l'import (« Annuler » la remet, via `onUndoImport`). */
  onImport: (file: File) => Promise<{ ok: boolean; undoId?: string }>;
  onUndoImport?: (undoId: string) => Promise<boolean>;
  // Panneaux composés par App (sauvegardes Drive, veille fiscale, appareils et confidentialité).
  backupSlot?: React.ReactNode;
  fiscalWatchSlot?: React.ReactNode;
  securitySlot?: React.ReactNode;
  taxNoticeSlot?: React.ReactNode;
  motivationSlot?: React.ReactNode;
  notificationPrefs?: Record<string, boolean>;
  onChangeNotificationPrefs?: (p: Record<string, boolean>) => void;
  /** Capital des parents encore présent : faux en mode solo (type de notification masqué). */
  hasParental?: boolean;
  paydayDay?: number;
  onOpenPayday?: () => void;
  /** « Se déconnecter » (confirmation par App) : sa place sur mobile, hors de l'en-tête. */
  onRequestLogout?: () => void;
}

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

type Edit<T> = (prev: T) => T;
const applyEdits = <T,>(base: T, edits: Edit<T>[]): T => edits.reduce((acc, edit) => edit(acc), base);

export const Settings: React.FC<SettingsProps> = ({ payslips = [], config, workBenefits, geminiApiKey, pickerApiKey, onUpdateFiscal, onUpdateBenefits, onSaveGeminiKey, onSavePickerKey, onExport, onImport, onUndoImport, paydayDay, onOpenPayday, backupSlot, fiscalWatchSlot, securitySlot, taxNoticeSlot, motivationSlot, notificationPrefs, onChangeNotificationPrefs, hasParental, onRequestLogout }) => {
  const toast = useToast();
  const { preference: themePreference } = useTheme();
  const { discreet } = useDiscreetMode();
  const [importMsg, setImportMsg] = useState<string | null>(null);
  // L'import écrase TOUT (comptes, mouvements, fiches de paie, réglages) puis
  // resynchronise sur Drive : il faut une confirmation explicite, la boîte de sélection de
  // fichier de l'OS n'en est pas une. On garde le fichier en attente le temps de l'accord.
  const [pendingImport, setPendingImport] = useState<File | null>(null);

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de resélectionner le même fichier après une annulation
    if (!file) return;
    setImportMsg(null);
    setPendingImport(file);
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    const file = pendingImport;
    setPendingImport(null);
    const { ok, undoId } = await onImport(file);
    // Les données remplacées ont été mises de côté : « Annuler » les remet tout de suite.
    if (ok && undoId && onUndoImport && toast) {
      setImportMsg(null);
      toast({
        message: 'Données importées (sauvegarde en cours)', kind: 'success',
        action: {
          label: 'Annuler',
          onClick: () => {
            void onUndoImport(undoId).then(done => toast(done
              ? { message: 'Import annulé : vos données d\'avant sont revenues', kind: 'success' }
              : { message: 'Annulation impossible : voyez « Versions mises de côté ».', kind: 'error' }));
          },
        },
      });
      return;
    }
    setImportMsg(ok ? 'Données importées (sauvegarde en cours).' : 'Fichier invalide : aucune donnée n\'a été remplacée.');
  };

  // Brouillon = données actuelles + modifications pas encore enregistrées. Ce ne sont PAS
  // des copies figées : ce qui change ailleurs pendant la saisie (veille fiscale « Appliquer »,
  // avis d'imposition, import, restauration) s'affiche aussitôt et n'est jamais défait, car
  // seules les modifications champ par champ sont rejouées sur l'état le plus récent.
  const [fiscalEdits, setFiscalEdits] = useState<Edit<FiscalConfig>[]>([]);
  const [benefitEdits, setBenefitEdits] = useState<Edit<WorkBenefits>[]>([]);
  const [geminiDraft, setGeminiDraft] = useState<string | null>(null);
  const [pickerDraft, setPickerDraft] = useState<string | null>(null);
  const localFiscal = useMemo(() => applyEdits(config, fiscalEdits), [config, fiscalEdits]);
  const localBenefits = useMemo(() => applyEdits(workBenefits, benefitEdits), [workBenefits, benefitEdits]);
  const localGeminiKey = geminiDraft ?? (geminiApiKey || '');
  const localPickerKey = pickerDraft ?? (pickerApiKey || '');
  const editFiscal = useCallback((edit: Edit<FiscalConfig>) => setFiscalEdits(prev => [...prev, edit]), []);
  const editBenefits = useCallback((edit: Edit<WorkBenefits>) => setBenefitEdits(prev => [...prev, edit]), []);

  // Enregistrement automatique, comme partout ailleurs dans l'app (plus de bouton « Tout
  // enregistrer » à ne pas oublier), 700 ms après la dernière frappe. Les cartes repliées
  // gardent leurs champs montés : un brouillon n'est jamais perdu en refermant une carte,
  // ni en quittant l'écran avant la fin du délai.
  const [savedHint, setSavedHint] = useState(false);
  const pending = { fiscalEdits, benefitEdits, geminiDraft, pickerDraft };
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const saversRef = useRef({ onUpdateFiscal, onUpdateBenefits, onSaveGeminiKey, onSavePickerKey });
  saversRef.current = { onUpdateFiscal, onUpdateBenefits, onSaveGeminiKey, onSavePickerKey };
  const flush = useCallback(() => {
    const p = pendingRef.current;
    const save = saversRef.current;
    if (p.fiscalEdits.length === 0 && p.benefitEdits.length === 0 && p.geminiDraft === null && p.pickerDraft === null) return;
    pendingRef.current = { fiscalEdits: [], benefitEdits: [], geminiDraft: null, pickerDraft: null };
    if (p.fiscalEdits.length > 0) save.onUpdateFiscal(prev => applyEdits(prev, p.fiscalEdits));
    if (p.benefitEdits.length > 0) save.onUpdateBenefits(prev => applyEdits(prev, p.benefitEdits));
    if (p.geminiDraft !== null) save.onSaveGeminiKey(p.geminiDraft.trim());
    if (p.pickerDraft !== null) save.onSavePickerKey(p.pickerDraft.trim());
    setFiscalEdits([]);
    setBenefitEdits([]);
    setGeminiDraft(null);
    setPickerDraft(null);
  }, []);
  const hasPending = fiscalEdits.length > 0 || benefitEdits.length > 0 || geminiDraft !== null || pickerDraft !== null;
  useEffect(() => {
    if (!hasPending) return;
    const t = setTimeout(() => { flush(); setSavedHint(true); }, 700);
    return () => clearTimeout(t);
  }, [hasPending, fiscalEdits, benefitEdits, geminiDraft, pickerDraft, flush]);
  useEffect(() => () => flush(), [flush]);

  // --- Cartes ouvertes (mémorisées sur cet appareil) et liens vers une carte ---
  const [openIds, setOpenIds] = useState<SettingsSection[]>(readOpenSections);
  const setOpen = useCallback((id: SettingsSection, open: boolean) => {
    setOpenIds(prev => {
      if (prev.includes(id) === open) return prev;
      const next = open ? [...prev, id] : prev.filter(x => x !== id);
      writeOpenSections(next);
      return next;
    });
  }, []);
  const isOpen = (id: SettingsSection) => openIds.includes(id);
  const toggle = (id: SettingsSection) => setOpen(id, !isOpen(id));

  // Ouvre la carte demandée, puis l'amène à l'écran et y place le focus. Le délai laisse
  // App remonter en haut de l'écran et poser le focus sur le titre (changement d'écran).
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reveal = useCallback((id: SettingsSection) => {
    setOpen(id, true);
    clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      clearRequestedSection();
      const el = document.getElementById(sectionAnchor(id));
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      el.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus({ preventScroll: true });
    }, 300);
  }, [setOpen]);
  useEffect(() => {
    const requested = peekRequestedSection();
    if (requested) reveal(requested);
    const onRequest = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (isSettingsSection(id)) reveal(id);
    };
    window.addEventListener(OPEN_SECTION_EVENT, onRequest);
    return () => { window.removeEventListener(OPEN_SECTION_EVENT, onRequest); clearTimeout(revealTimer.current); };
  }, [reveal]);

  const backend = isBackendEnabled();
  const keysSummary = [
    localGeminiKey.trim() ? 'Gemini configurée' : 'Pas de clé Gemini',
    localPickerKey.trim() ? 'Picker configurée' : 'pas de clé Picker',
  ].join(' · ');

  const card = (id: SettingsSection, title: string, icon: React.ComponentType<{ className?: string }>, children: React.ReactNode, summary?: string) => (
    <SettingsCard key={id} id={id} title={title} icon={icon} summary={summary} open={isOpen(id)} onToggle={() => toggle(id)}>{children}</SettingsCard>
  );

  const group = (title: string, cards: React.ReactNode[]) => (
    <div className="space-y-3">
      <h3 className="px-1 text-sm font-medium text-on-surface-variant">{title}</h3>
      {cards}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto animate-fade-in pb-20">
      <PageHeader
        title="Paramètres"
        subtitle="Vos avantages et la fiscalité, les préférences de l'app, la sécurité et vos sauvegardes. Ouvrez une carte pour la modifier."
        actions={
          <p role="status" className="text-sm text-on-surface-variant flex items-center gap-1.5">
            <Save className="w-4 h-4" aria-hidden="true" /> {savedHint ? 'Modifications enregistrées' : 'Enregistrement automatique'}
          </p>
        }
      />

      <div className="space-y-8">
        {group('Salaire et impôts', [
          card('benefits', 'Avantages salariaux', Building2,
            <BenefitsFields payslips={payslips} benefits={localBenefits} setBenefits={editBenefits} fiscal={localFiscal} />,
            benefitsSummary(localBenefits)),
          card('fiscal', 'Fiscalité et barème', Scale,
            <FiscalFields fiscal={localFiscal} setFiscal={editFiscal} />,
            fiscalSummary(localFiscal)),
          taxNoticeSlot && card('tax-notice', "Avis d'imposition (LEP)", FileSearch, taxNoticeSlot),
          fiscalWatchSlot && card('fiscal-watch', 'Veille fiscale', Radar, fiscalWatchSlot),
        ])}

        {group('Préférences', [
          card('display', 'Affichage', Palette, <DisplaySection />, displaySummary(themePreference, discreet)),
          motivationSlot && card('motivation', 'Motivation', Sprout, motivationSlot),
          backend && card('notifications', 'Notifications', Bell,
            <NotificationSettings paydayDay={paydayDay} onOpenPayday={onOpenPayday} prefs={notificationPrefs} onChangePrefs={onChangeNotificationPrefs} hasParental={hasParental} />),
          card('keys', 'Clés et services', KeyRound, (
            <div className="space-y-5">
              <Hint>Les fiches de paie, les avis d'imposition et les relevés bancaires sont lus par Gemini avec votre propre clé, gardée sur cet appareil et effacée à la déconnexion ; la clé Picker sert à choisir un fichier déjà sur votre Drive.</Hint>
              <TextField id="gemini-key" label="Clé API Gemini (cet appareil)" type="password" autoComplete="off" spellCheck={false}
                value={localGeminiKey} onChange={e => setGeminiDraft(e.target.value)} placeholder="AIza..."
                supporting="Sert à lire les fiches de paie et les relevés, et à la veille fiscale hebdomadaire. Créée sur Google AI Studio ; restreignez-la à l'API « Generative Language » dans Google Cloud." />
              <GeminiModelField />
              <TextField id="picker-key" label="Clé API Google Picker" type="password" autoComplete="off" spellCheck={false}
                value={localPickerKey} onChange={e => setPickerDraft(e.target.value)} placeholder="AIza..."
                supporting="Permet de choisir une fiche déjà présente sur votre Drive. Créée dans Google Cloud Console, restreinte à l'API Picker." />
              <Notice icon={AlertTriangle}>
                La clé Gemini reste sur cet appareil : elle n'est ni dans votre fichier Drive, ni dans les exports (à ressaisir sur chaque appareil). La clé Picker, publique par nature, est synchronisée. Chaque analyse utilise votre propre quota Gemini.
              </Notice>
            </div>
          ), keysSummary),
        ])}

        {group('Sécurité et données', [
          card('lock', "Verrou de l'appareil", Fingerprint, <LockSection />),
          card('data', 'Sauvegardes et données', Database, (
            <div>
              <Hint>Un export télécharge une copie locale de toutes vos données (sans votre clé Gemini). L'import remplace les données actuelles puis les resynchronise sur Drive.</Hint>
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <Button variant="tonal" onClick={onExport}><Download className="w-4 h-4" aria-hidden="true" /> Exporter (JSON)</Button>
                <label className="touch-target h-10 px-6 rounded-full text-sm font-medium inline-flex items-center gap-2 border border-outline text-primary hover:bg-primary/8 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-offset-2">
                  <Upload className="w-4 h-4" aria-hidden="true" /> Importer un fichier
                  <input type="file" accept="application/json" onChange={handleImportFile} className="sr-only" />
                </label>
              </div>
              {importMsg && <p role="status" className="mt-2 text-sm text-on-surface-variant">{importMsg}</p>}

              {pendingImport && (
                <Notice tone="error" className="mt-4 p-4!">
                  <p className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> Remplacer toutes vos données ?</p>
                  <p className="mt-2">
                    « {pendingImport.name} » va écraser <strong className="font-medium">l'intégralité</strong> de vos comptes, mouvements,
                    fiches de paie et réglages actuels, puis être synchronisé sur Drive. Vos données
                    actuelles sont d'abord mises de côté sur cet appareil si la place le permet : vous pourrez
                    annuler juste après. En cas de doute, faites d'abord un export.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="danger" onClick={confirmImport}>Remplacer mes données</Button>
                    <Button variant="text" onClick={() => setPendingImport(null)}>Annuler</Button>
                  </div>
                </Notice>
              )}
              {backupSlot}
            </div>
          )),
          securitySlot && card('account', 'Compte et appareils', Smartphone, securitySlot),
          card('device', 'Appareil', HardDrive, <DeviceSection />),
          onRequestLogout && (
            <div key="logout" className="px-1 pt-1">
              <Button variant="outlined" className="text-error! border-error/40! enabled:hover:bg-error/8!" onClick={onRequestLogout}>
                <LogOut className="w-4 h-4" aria-hidden="true" /> Se déconnecter
              </Button>
              <p className="mt-2 px-1 text-xs text-on-surface-variant">Vos données restent sur votre Drive ; il faudra vous reconnecter avec Google. La clé Gemini de cet appareil est effacée.</p>
            </div>
          ),
        ])}

        {card('about', 'À propos', Info, <AboutSection />, `Version ${LATEST_VERSION}`)}
      </div>
    </div>
  );
};
