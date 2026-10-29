// « Partager vers Pécule » : un fichier partagé depuis une autre app (Gmail, Drive, Fichiers…)
// a été reçu par le service worker (public/share-sw.js). Affiché seulement une fois l'app
// déverrouillée et les données chargées : le fichier est pris (et effacé de l'appareil), puis
// l'utilisateur choisit ce que c'est. Rien n'est envoyé à Gemini avant ce choix ; sans clé
// Gemini, le fichier est abandonné.
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, KeyRound, Landmark, ReceiptText, X } from 'lucide-react';
import type { StatementImportItem } from '../../lib/commands';
import type { ScreenData } from '../../app/ScreenRouter';
import { Modal } from '../Modal';
import { Button, IconButton } from '../ui';
import { StatementImport } from '../StatementImport';
import { TaxNoticePanel } from '../TaxNoticePanel';
import { isDemoSession } from '../../services/statementReader';
import { discardSharedFile, parseShareMarker, takeSharedFile, type ShareMarker } from '../../services/sharedFile';
import { stripParam } from '../../app/useAppNavigation';

export interface ShareTargetHostProps {
  /** Valeur brute de `?partage=` laissée par le service worker. */
  marker: string;
  /** Données chargées : le fichier n'est pris qu'à ce moment-là. */
  ready: boolean;
  /** Document et clé Gemini ; l'avis d'imposition s'enregistre comme depuis les Paramètres. */
  data: Pick<ScreenData, 'doc' | 'geminiApiKey' | 'patchConfig' | 'setFiscalConfig'>;
  onImportStatement: (items: StatementImportItem[]) => string | null;
  /** Fiche de paie : ouvre l'écran des fiches avec ce fichier comme import en cours. */
  onPayslip: (file: File) => void;
  /** Ouvre Paramètres, rubrique « Clés et services ». */
  onOpenKeys: () => void;
  /** Fin du partage (import fait, annulé, ou refusé). */
  onDone: () => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'choose'; file: File }
  | { kind: 'statement'; file: File }
  | { kind: 'tax'; file: File }
  | { kind: 'no-key' }
  | { kind: 'missing' }
  | { kind: 'refused'; reason: Exclude<ShareMarker, 'received'> };

const REFUSED_TEXT: Record<Exclude<ShareMarker, 'received'>, string> = {
  type: 'Pécule ne lit que les PDF et les images (PNG, JPEG, WebP). Le fichier partagé n\'a pas été gardé.',
  size: 'Ce fichier est trop lourd : 15 Mo au plus. Il n\'a pas été gardé.',
  failed: 'Le fichier partagé n\'a pas pu être reçu. Partagez-le à nouveau.',
};

const CHOICES = [
  { key: 'payslip', icon: FileText, label: 'Fiche de paie', supporting: 'L\'IA en lit les montants, vous les vérifiez. Le fichier n\'est pas copié sur votre Drive.' },
  { key: 'statement', icon: Landmark, label: 'Relevé bancaire', supporting: 'Nouveaux soldes et opérations, compte par compte, avant votre validation.' },
  { key: 'tax', icon: ReceiptText, label: 'Avis d\'imposition', supporting: 'Revenu fiscal de référence, pour l\'éligibilité au LEP.' },
] as const;
type Choice = (typeof CHOICES)[number]['key'];

/** « 820 Ko », « 2,4 Mo » : taille du fichier reçu. */
export const describeFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} octet${bytes > 1 ? 's' : ''}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
};

/** « reçu aujourd'hui à 14:32 », sinon avec la date (l'heure de réception est gardée par share-sw.js). */
export const describeReceivedAt = (at: number, now = Date.now()): string => {
  const d = new Date(at);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString()
    ? `reçu aujourd'hui à ${time}`
    : `reçu le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${time}`;
};

export const ShareTargetHost: React.FC<ShareTargetHostProps> = props => {
  const { marker, ready, data, onDone } = props;
  const { geminiApiKey, doc } = data;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Le fichier n'est pris qu'une fois, même si l'effet est rejoué (mode strict).
  const taken = useRef<Promise<File | null> | null>(null);
  const canRead = isDemoSession() || !!geminiApiKey;

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    // L'adresse est nettoyée : un rechargement ne rejoue pas le partage.
    stripParam('partage');
    const parsed = parseShareMarker(marker) ?? 'failed';
    if (parsed !== 'received') {
      void discardSharedFile().catch(() => undefined);
      setPhase({ kind: 'refused', reason: parsed });
      return;
    }
    taken.current ??= takeSharedFile().catch(() => null);
    void taken.current.then(file => {
      if (!alive) return;
      if (!file) setPhase({ kind: 'missing' });
      // Sans clé, rien ne peut être lu : le fichier, déjà effacé de l'appareil, est abandonné.
      else if (!canRead) setPhase({ kind: 'no-key' });
      else setPhase({ kind: 'choose', file });
    });
    return () => { alive = false; };
  }, [ready, marker, canRead]);

  const choose = (file: File, choice: Choice) => {
    if (choice === 'payslip') { props.onPayslip(file); onDone(); }
    else setPhase({ kind: choice, file });
  };

  if (phase.kind === 'loading') return null;

  if (phase.kind === 'statement') {
    return <StatementImport accounts={doc.accounts} geminiApiKey={geminiApiKey} initialFile={phase.file}
      onClose={onDone} onImport={props.onImportStatement} onOpenKeys={props.onOpenKeys} />;
  }

  if (phase.kind === 'tax') {
    const rfrByYear = doc.config.rfrByYear || {};
    return (
      <Modal open onClose={onDone} label="Avis d'imposition" variant="sheet" className="max-w-2xl p-4 sm:p-6" closeOnScrim={false}>
        <div className="flex justify-end -mt-2 -mr-1 sm:-mr-3">
          <IconButton icon={X} label="Fermer" onClick={onDone} />
        </div>
        <TaxNoticePanel geminiApiKey={geminiApiKey} rfrByYear={rfrByYear} householdParts={doc.fiscalConfig.lepHouseholdParts}
          onSave={(y, v) => data.patchConfig({ rfrByYear: { ...rfrByYear, [String(y)]: v } })}
          onSetParts={parts => data.setFiscalConfig(prev => ({ ...prev, lepHouseholdParts: parts }))} initialFile={phase.file} />
        <div className="mt-4 flex justify-end"><Button variant="text" onClick={onDone}>Fermer</Button></div>
      </Modal>
    );
  }

  if (phase.kind === 'choose') {
    const { file } = phase;
    return (
      <Modal open onClose={onDone} label="Que voulez-vous importer ?" variant="sheet" className="max-w-lg p-6">
        <h2 className="text-2xl font-normal text-on-surface">Que voulez-vous importer ?</h2>
        {/* N'importe quel site peut envoyer un fichier sur `partager` : nom, taille et heure
            permettent de reconnaître (ou non) son propre partage avant toute lecture. */}
        <p className="mt-2 text-sm font-medium text-on-surface break-all">{file.name}</p>
        <p className="mt-0.5 text-sm text-on-surface-variant">{describeFileSize(file.size)} · {describeReceivedAt(file.lastModified)}</p>
        <p className="mt-3 rounded-xl bg-tertiary-container text-on-tertiary-container p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>Vous n'avez rien partagé ? Annulez : le fichier sera effacé sans être lu.</span>
        </p>
        <p className="mt-3 text-xs text-on-surface-variant">
          {isDemoSession()
            ? 'Mode démo : rien n\'est envoyé.'
            : 'Le fichier reste sur cet appareil le temps de l\'import. Il n\'est envoyé à Google Gemini, avec votre clé, qu\'après votre choix.'}
        </p>
        <ul className="mt-4 space-y-2">
          {CHOICES.map(c => (
            <li key={c.key}>
              <button type="button" onClick={() => choose(file, c.key)}
                className="w-full min-h-16 flex items-start gap-4 rounded-2xl bg-surface-container-low hover:bg-on-surface/8 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary">
                <c.icon className="w-6 h-6 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-base font-medium text-on-surface">{c.label}</span>
                  <span className="block text-sm text-on-surface-variant">{c.supporting}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end">
          <Button variant="text" onClick={onDone}>Annuler</Button>
        </div>
      </Modal>
    );
  }

  // Fichier refusé, introuvable, ou clé manquante : un message, et le fichier n'existe plus.
  const noKey = phase.kind === 'no-key';
  const text = noKey
    ? 'Pour lire ce document, Pécule a besoin d\'une clé Gemini. Ajoutez-la dans Paramètres, rubrique « Clés et services », puis partagez le fichier à nouveau. Le fichier reçu a été effacé.'
    : phase.kind === 'missing'
      ? 'Le fichier partagé n\'est plus disponible : il est effacé dès sa lecture, et au bout d\'une heure s\'il n\'a pas été ouvert. Partagez-le à nouveau.'
      : REFUSED_TEXT[phase.reason];
  return (
    <Modal open onClose={onDone} label="Fichier non importé" variant="sheet" className="max-w-lg p-6">
      <h2 className="text-2xl font-normal text-on-surface flex items-center gap-3">
        {noKey ? <KeyRound className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" /> : <AlertTriangle className="w-6 h-6 shrink-0 text-tertiary" aria-hidden="true" />}
        Fichier non importé
      </h2>
      <p className="mt-3 text-sm text-on-surface-variant">{text}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {noKey && <Button variant="tonal" onClick={() => { onDone(); props.onOpenKeys(); }}>Ouvrir « Clés et services »</Button>}
        <Button variant={noKey ? 'text' : 'filled'} onClick={onDone}>Fermer</Button>
      </div>
    </Modal>
  );
};
