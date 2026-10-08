// ================================================
// FILE: src/components/Settings.tsx
// Écran Paramètres : une liste courte de cartes repliables, regroupées par thème. Chaque
// carte résume son état sur une ligne ; les cartes ouvertes sont mémorisées sur cet
// appareil, et un lien peut en ouvrir une (voir settings/sections).
// ================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiscalConfig, PayslipRecord, WorkBenefits } from '../types';
import {
  AlertTriangle, Download, Upload, Database, KeyRound, Fingerprint, Building2, Scale, FileSearch, Radar, Sprout, Bell,
  Smartphone, Info, Save,
} from 'lucide-react';
import { NotificationSettings } from './NotificationSettings';
import { GeminiModelField } from './SettingsPanels';
import { isBackendEnabled } from '../services/backendService';
import { LATEST_VERSION } from '../changelog';
import { Button, PageHeader, TextField } from './ui';
import { SettingsCard, Hint, Notice } from './settings/SettingsCard';
import { BenefitsFields, FiscalFields, benefitsSummary, fiscalSummary } from './settings/SalarySections';
import { LockSection } from './settings/LockSection';
import { AboutSection } from './settings/AboutSection';
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
  onSave: (newConfig: FiscalConfig, newBenefits: WorkBenefits, newGeminiKey: string, newPickerKey: string) => void;
  onExport: () => void;
  onImport: (file: File) => Promise<boolean>;
  // Panneaux composés par App (sauvegardes Drive, veille fiscale, appareils et confidentialité).
  backupSlot?: React.ReactNode;
  fiscalWatchSlot?: React.ReactNode;
  securitySlot?: React.ReactNode;
  taxNoticeSlot?: React.ReactNode;
  motivationSlot?: React.ReactNode;
  notificationPrefs?: Record<string, boolean>;
  onChangeNotificationPrefs?: (p: Record<string, boolean>) => void;
  paydayDay?: number;
  onOpenPayday?: () => void;
}

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export const Settings: React.FC<SettingsProps> = ({ payslips = [], config, workBenefits, geminiApiKey, pickerApiKey, onSave, onExport, onImport, paydayDay, onOpenPayday, backupSlot, fiscalWatchSlot, securitySlot, taxNoticeSlot, motivationSlot, notificationPrefs, onChangeNotificationPrefs }) => {
  const [importMsg, setImportMsg] = useState<string | null>(null);
  // L'import écrase TOUT (comptes, mouvements, objectifs, fiches de paie, réglages) puis
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
    const ok = await onImport(file);
    setImportMsg(ok ? 'Données importées (sauvegarde en cours).' : 'Fichier invalide : aucune donnée n\'a été remplacée.');
  };

  const [localFiscal, setLocalFiscal] = useState<FiscalConfig>(config);
  const [localBenefits, setLocalBenefits] = useState<WorkBenefits>(workBenefits);
  const [localGeminiKey, setLocalGeminiKey] = useState<string>(geminiApiKey || '');
  const [localPickerKey, setLocalPickerKey] = useState<string>(pickerApiKey || '');

  // Enregistrement automatique, comme partout ailleurs dans l'app (plus de bouton « Tout
  // enregistrer » à ne pas oublier). Les cartes repliées gardent leurs champs montés : un
  // brouillon n'est jamais perdu en refermant une carte.
  const [savedHint, setSavedHint] = useState(false);
  const dirty = JSON.stringify([localFiscal, localBenefits, localGeminiKey.trim(), localPickerKey.trim()])
    !== JSON.stringify([config, workBenefits, geminiApiKey || '', pickerApiKey || '']);
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      onSave(localFiscal, localBenefits, localGeminiKey.trim(), localPickerKey.trim());
      setSavedHint(true);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFiscal, localBenefits, localGeminiKey, localPickerKey]);

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
            <BenefitsFields payslips={payslips} benefits={localBenefits} setBenefits={setLocalBenefits} />,
            benefitsSummary(localBenefits)),
          card('fiscal', 'Fiscalité et barème', Scale,
            <FiscalFields fiscal={localFiscal} setFiscal={setLocalFiscal} />,
            fiscalSummary(localFiscal)),
          taxNoticeSlot && card('tax-notice', "Avis d'imposition (LEP)", FileSearch, taxNoticeSlot),
          fiscalWatchSlot && card('fiscal-watch', 'Veille fiscale', Radar, fiscalWatchSlot),
        ])}

        {group('Préférences', [
          motivationSlot && card('motivation', 'Motivation', Sprout, motivationSlot),
          backend && card('notifications', 'Notifications', Bell,
            <NotificationSettings paydayDay={paydayDay} onOpenPayday={onOpenPayday} prefs={notificationPrefs} onChangePrefs={onChangeNotificationPrefs} />),
          card('keys', 'Clés et services', KeyRound, (
            <div className="space-y-5">
              <Hint>Les fiches de paie et les avis d'imposition sont lus par Gemini avec votre propre clé ; la clé Picker sert à choisir un fichier déjà sur votre Drive.</Hint>
              <TextField id="gemini-key" label="Clé API Gemini (cet appareil)" type="password" autoComplete="off" spellCheck={false}
                value={localGeminiKey} onChange={e => setLocalGeminiKey(e.target.value)} placeholder="AIza..."
                supporting="Sert à lire les fiches de paie et à la veille fiscale hebdomadaire. Créée sur Google AI Studio ; restreignez-la à l'API « Generative Language » dans Google Cloud." />
              <GeminiModelField />
              <TextField id="picker-key" label="Clé API Google Picker" type="password" autoComplete="off" spellCheck={false}
                value={localPickerKey} onChange={e => setLocalPickerKey(e.target.value)} placeholder="AIza..."
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
                <label className="h-10 px-6 rounded-full text-sm font-medium inline-flex items-center gap-2 border border-outline text-indigo-700 dark:text-indigo-200 hover:bg-indigo-600/8 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-600 has-[:focus-visible]:outline-offset-2">
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
                    objectifs, fiches de paie et réglages actuels, puis être synchronisé sur Drive. Cette action
                    est irréversible — pensez à faire un export avant en cas de doute.
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
        ])}

        {card('about', 'À propos', Info, <AboutSection />, `Version ${LATEST_VERSION}`)}
      </div>
    </div>
  );
};
