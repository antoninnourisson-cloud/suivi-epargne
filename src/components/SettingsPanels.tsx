// Panneaux de Paramètres liés à la sécurité et à la sauvegarde : copies mensuelles Drive,
// sauvegarde de secours chiffrée, appareils et données gardés par le serveur, modèle Gemini.
// Ils s'affichent dans les cartes repliables de l'écran (voir settings/SettingsCard) et y
// signalent leur état pour le résumé de la carte (useCardSummary).
import React, { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, Smartphone, Loader2, Trash2, LogOut, Activity, ShieldCheck, Copy, CloudUpload, CloudDownload, KeyRound } from 'lucide-react';
import type { DriveBackup } from '../services/googleDriveService';
import type { GlobalAppData } from '../types';
import {
  isCloudBackupAvailable, getDeviceEnrollment, getServerBackups, readStatus, generateRecoveryCode, enableWithNewCode,
  enableWithExistingCode, uploadNow, decryptServerBackup, disableAndScheduleDeletion, cancelServerDeletion, failureCode, FAILURE_MESSAGES,
  verifyRecoveryCode, type CloudBackupStatus, type ServerDeletion,
} from '../services/cloudBackup';
import { backupCodeCheckDue, type BackupEnrollment } from '../lib/recoveryCodeCheck';
import { RecoveryCodeCheck, DownloadCodeButton } from './settings/RecoveryCodeCheck';
import { ServerSessionsList } from './settings/ServerSessionsList';
import { validateImport } from '../lib/schema';
import { Button, Chip, IconButton, TextField } from './ui';
import {
  isBackendEnabled, listPushDevices, removePushDevice, logoutAllDevices, deleteServerAccount, getServerHealth,
  PushDevice, ServerHealth,
} from '../services/backendService';
import { DEFAULT_GEMINI_MODEL, getGeminiModelOverride, setGeminiModelOverride } from '../services/geminiModel';
import { useToast } from './Toast';
import { CardSubheading, Hint, Notice, useCardSummary } from './settings/SettingsCard';
import { SwitchRow } from './settings/fields';
import { elideDe } from '../lib/format';

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** « de septembre 2026 », mais « d'août 2026 », « d'octobre 2026 ». */
const ofMonth = elideDe;

/**
 * Copies mensuelles du fichier sur Drive, restaurables en un clic (après confirmation). Les
 * données actuelles sont d'abord mises de côté : « Annuler » dans le message qui suit, ou
 * « Versions mises de côté » pendant 30 jours.
 */
export const DriveBackupsPanel: React.FC<{
  list: () => Promise<DriveBackup[]>;
  /** Restaure ; renvoie de quoi annuler (identifiant de la version mise de côté). */
  restore: (id: string, label: string) => Promise<string | void>;
  /** Annule une restauration (remet la version mise de côté). */
  undo?: (undoId: string) => Promise<boolean>;
  confirm: (title: string, message: string, onOk: () => void | Promise<void>, confirmLabel?: string) => void;
}> = ({ list, restore, undo, confirm }) => {
  const toast = useToast();
  const [items, setItems] = useState<DriveBackup[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { list().then(setItems).catch(() => setItems([])); }, [list]);
  const latest = items && items.length > 0 ? [...items].sort((a, b) => b.createdTime.localeCompare(a.createdTime))[0] : null;
  useCardSummary('drive', items === null ? null : latest ? `Dernière copie Drive : ${shortDay(latest.createdTime)}` : 'Pas encore de copie Drive');
  return (
    <div className="pt-5 mt-5 border-t border-outline-variant">
      <CardSubheading icon={ArchiveRestore}>Copies mensuelles sur Drive</CardSubheading>
      <Hint className="mt-1">Une copie complète est créée au premier enregistrement de chaque mois ; les 12 dernières sont gardées. Choisissez un mois pour y revenir.</Hint>
      {items === null ? <Loader2 className="w-4 h-4 animate-spin mt-3 text-on-surface-variant" aria-label="Chargement" />
        : items.length === 0 ? <p className="text-sm text-on-surface-variant mt-3">Pas encore de copie : la première sera créée au prochain enregistrement.</p>
        : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {items.map(b => (
              <li key={b.id}>
                <Chip kind="suggestion" disabled={busy}
                  className="disabled:opacity-40 capitalize"
                  onClick={() => confirm(
                    `Revenir à la copie ${ofMonth(monthLabel(b.month))} ?`,
                    'Toutes vos données actuelles seront remplacées par cette copie, puis enregistrées sur Drive. Elles sont d\'abord mises de côté sur cet appareil : vous pourrez annuler juste après, ou les récupérer pendant 30 jours (« Versions mises de côté »).',
                    async () => {
                      setBusy(true);
                      const of = ofMonth(monthLabel(b.month));
                      try {
                        const undoId = await restore(b.id, of);
                        toast?.({
                          message: `Copie ${of} restaurée`, kind: 'success',
                          action: undoId && undo ? {
                            label: 'Annuler',
                            onClick: () => { void undo(undoId).then(ok => toast?.(ok ? { message: 'Restauration annulée', kind: 'success' } : { message: 'Annulation impossible : voyez « Versions mises de côté ».', kind: 'error' })); },
                          } : undefined,
                        });
                      } catch (e) {
                        toast?.({
                          message: e instanceof Error && e.message === 'SET_ASIDE_FAILED'
                            ? 'Impossible de mettre vos données actuelles de côté sur cet appareil : rien n\'a été remplacé.'
                            : 'Copie illisible : rien n\'a été remplacé.',
                          kind: 'error',
                        });
                      }
                      finally { setBusy(false); }
                    },
                    `Remplacer par la copie ${ofMonth(monthLabel(b.month))}`,
                  )}>{monthLabel(b.month)}</Chip>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
};

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeLabel = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
const errorMessage = (e: unknown) => FAILURE_MESSAGES[failureCode(e)];

type CloudMode = 'idle' | 'newCode' | 'verify' | 'join' | 'restore' | 'check';

/**
 * Sauvegarde de secours chiffrée de bout en bout, gardée par le serveur (conservation
 * échelonnée, effacement différé de 7 jours). Le code de secours n'est montré qu'UNE fois,
 * et n'est activé qu'après en avoir recopié deux groupes ; la restauration passe par le même contrôle qu'un
 * import de fichier (validateImport, puis migrate dans importData), qui met d'abord les
 * données actuelles de côté et ne remplace rien s'il ne le peut pas (SET_ASIDE_FAILED).
 */
export const CloudBackupPanel: React.FC<{
  getData: () => GlobalAppData;
  /** `undoId` : version mise de côté juste avant (« Annuler » la remet, via `undo`). */
  onImport: (file: File, opts?: { requireSetAside?: boolean }) => Promise<{ ok: boolean; undoId?: string }>;
  undo?: (undoId: string) => Promise<boolean>;
  confirm: (title: string, message: string, onOk: () => void | Promise<void>, danger?: boolean, confirmLabel?: string) => void;
}> = ({ getData, onImport, undo, confirm }) => {
  const toast = useToast();
  const [available] = useState(isCloudBackupAvailable);
  const [enrolled, setEnrolled] = useState<BackupEnrollment | null | undefined>(undefined);
  const [dates, setDates] = useState<string[] | null>(null);
  const [deletion, setDeletion] = useState<ServerDeletion | null>(null);
  const [status, setStatus] = useState<CloudBackupStatus>(readStatus);
  const [mode, setMode] = useState<CloudMode>('idle');
  const [newCode, setNewCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [restoreDate, setRestoreDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    void getDeviceEnrollment().then(setEnrolled);
    setStatus(readStatus());
    getServerBackups().then(({ dates: d, deletion: del }) => {
      setDates(d);
      setDeletion(del);
      setRestoreDate(prev => (prev && d.includes(prev) ? prev : d[0] ?? ''));
    }).catch(() => setDates([]));
  }, []);
  useEffect(() => { if (available) refresh(); }, [available, refresh]);
  // Un effacement programmé passe avant tout le reste dans le résumé : visible carte fermée.
  useCardSummary('cloud', !available ? null
    : deletion ? `Effacement des copies prévu le ${new Date(deletion.purgeAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
    : enrolled === undefined ? null : enrolled ? 'Secours chiffré activé' : 'Secours chiffré désactivé');

  if (!available) return null;

  const reset = () => { setMode('idle'); setNewCode(null); setCodeInput(''); setError(null); setCopied(false); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); refresh(); }
  };

  const startEnable = () => { reset(); setNewCode(generateRecoveryCode().code); setMode('newCode'); };
  const copyCode = async () => {
    if (!newCode) return;
    try { await navigator.clipboard.writeText(newCode); setCopied(true); } catch { setError('Copie impossible : recopiez le code à la main.'); }
  };
  // « Je l'ai noté » : d'abord recopier deux groupes du code (RecoveryCodeCheck), puis activer.
  const confirmSaved = () => run(async () => {
    await enableWithNewCode(newCode!);
    reset();
    try { await uploadNow(getData()); toast?.({ message: 'Sauvegarde de secours activée et première copie envoyée', kind: 'success' }); }
    catch (e) { toast?.({ message: `Sauvegarde activée, mais le premier envoi a échoué : ${errorMessage(e)}`, kind: 'error' }); }
  });
  const join = () => run(async () => {
    await enableWithExistingCode(codeInput);
    reset();
    toast?.({ message: 'Sauvegarde de secours activée sur cet appareil', kind: 'success' });
  });
  // Vérification annuelle : le code retapé est comparé sur l'appareil (rien n'est envoyé).
  const checkCode = () => run(async () => {
    if (!(await verifyRecoveryCode(codeInput))) {
      setError('Ce code ne correspond pas à la sauvegarde de cet appareil. Code perdu ? Désactivez puis réactivez la sauvegarde pour en créer un nouveau.');
      return;
    }
    reset();
    toast?.({ message: "Code de secours vérifié : c'est le bon. Prochain rappel dans un an.", kind: 'success' });
  });
  const sendNow = () => run(async () => {
    await uploadNow(getData());
    toast?.({ message: 'Copie de secours envoyée', kind: 'success' });
  });
  const restore = () => run(async () => {
    const json = await decryptServerBackup(restoreDate, codeInput);
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { parsed = null; }
    if (validateImport(parsed).length > 0) { setError('Copie déchiffrée mais illisible par cette version de Pécule : rien n\'a été remplacé.'); return; }
    const label = dayLabel(restoreDate);
    confirm(`Remplacer vos données par la copie du ${label} ?`,
      'Toutes vos données actuelles (comptes, mouvements, fiches de paie, réglages) seront remplacées par cette copie, puis enregistrées sur Drive. Elles sont d\'abord mises de côté sur cet appareil : vous pourrez annuler juste après, ou les récupérer pendant 30 jours (« Versions mises de côté »).',
      async () => {
        let outcome: { ok: boolean; undoId?: string };
        try {
          outcome = await onImport(new File([json], `pecule-secours-${restoreDate}.json`, { type: 'application/json' }), { requireSetAside: true });
        } catch (e) {
          // La promesse « mises de côté d'abord » ne peut pas être tenue : rien n'est remplacé.
          toast?.({
            message: e instanceof Error && e.message === 'SET_ASIDE_FAILED'
              ? 'Impossible de mettre vos données actuelles de côté sur cet appareil : rien n\'a été remplacé.'
              : 'Copie refusée : rien n\'a été remplacé.',
            kind: 'error',
          });
          return;
        }
        const { undoId } = outcome;
        if (outcome.ok) {
          reset();
          toast?.({
            message: `Copie de secours du ${label} restaurée`, kind: 'success',
            action: undoId && undo ? {
              label: 'Annuler',
              onClick: () => { void undo(undoId).then(done => toast?.(done ? { message: 'Restauration annulée', kind: 'success' } : { message: 'Annulation impossible : voyez « Versions mises de côté ».', kind: 'error' })); },
            } : undefined,
          });
        } else toast?.({ message: 'Copie refusée : rien n\'a été remplacé.', kind: 'error' });
      }, true, `Remplacer par la copie du ${label}`);
  });
  const disable = () => confirm('Désactiver la sauvegarde de secours ?',
    'Cet appareil n\'enverra plus de copie. Les copies chiffrées gardées par le serveur seront effacées dans 7 jours : d\'ici là, vous pourrez annuler cet effacement ici, et vos appareils qui reçoivent les notifications en sont prévenus. Votre fichier Drive et ses copies mensuelles ne changent pas.',
    () => run(async () => {
      const { copies, purgeAt } = await disableAndScheduleDeletion();
      reset();
      toast?.({
        message: purgeAt
          ? `Sauvegarde de secours désactivée : ${copies} copie${copies > 1 ? 's' : ''} effacée${copies > 1 ? 's' : ''} d'ici le ${dateTimeLabel(purgeAt)}`
          : 'Sauvegarde de secours désactivée',
        kind: 'success',
      });
    }), true);
  const cancelDeletion = () => run(async () => {
    await cancelServerDeletion();
    toast?.({ message: 'Effacement des copies de secours annulé', kind: 'success' });
  });

  const hasCopies = !!dates && dates.length > 0;

  return (
    <div className="pt-5 mt-5 border-t border-outline-variant" data-testid="cloud-backup-panel">
      <CardSubheading icon={ShieldCheck}>Sauvegarde de secours chiffrée</CardSubheading>
      <Hint className="mt-1">
        Une copie de vos données, chiffrée sur cet appareil avant l'envoi, gardée par le serveur de Pécule au cas où le fichier Drive serait abîmé ou supprimé.
        Le serveur ne peut pas la lire : seul votre <strong className="font-medium text-on-surface">code de secours</strong> permet de la déchiffrer. Envoi automatique au plus une fois par semaine si vos données ont changé ;
        le serveur garde les copies récentes et au moins une par mois sur un an, et ne les efface jamais sur-le-champ (7 jours de délai, annulable).
      </Hint>

      {deletion && (
        <Notice tone="error" className="mt-3 p-4!">
          <p className="text-sm font-medium">Effacement des copies programmé</p>
          <p className="mt-1">
            Demandé le {dateTimeLabel(deletion.requestedAt)}. Les copies présentes à cette date seront effacées d'ici le {dateTimeLabel(deletion.purgeAt)} ; celles envoyées depuis ne sont pas concernées.
            Ce n'est pas vous ? Annulez l'effacement, puis déconnectez les appareils que vous ne reconnaissez pas.
          </p>
          <Button variant="tonal" className="mt-3" onClick={cancelDeletion} disabled={busy}>Annuler l'effacement</Button>
        </Notice>
      )}

      {enrolled === undefined ? <Loader2 className="w-4 h-4 animate-spin mt-3 text-on-surface-variant" aria-label="Chargement" /> : (
        <>
          <p role="status" className="mt-3 text-sm text-on-surface">
            {enrolled
              ? <>Activée sur cet appareil. {status.lastUploadAt ? `Dernier envoi : ${dateTimeLabel(status.lastUploadAt)}.` : 'Aucun envoi pour l\'instant.'}
                {status.lastError && status.lastErrorAt && (!status.lastUploadAt || status.lastErrorAt > status.lastUploadAt)
                  && <span className="block text-error">Échec du dernier essai ({dateTimeLabel(status.lastErrorAt)}) : {FAILURE_MESSAGES[status.lastError as keyof typeof FAILURE_MESSAGES] ?? status.lastError}</span>}</>
              : 'Pas activée sur cet appareil.'}
            {enrolled && (backupCodeCheckDue(enrolled, new Date())
              ? <span className="block font-medium text-tertiary">Votre code de secours n'a pas été retapé depuis un an : vérifiez qu'il est toujours à portée de main.</span>
              : enrolled.codeCheckedAt && <span className="block text-on-surface-variant">Code de secours vérifié le {new Date(enrolled.codeCheckedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.</span>)}
            {dates && <span className="block text-on-surface-variant">{hasCopies ? `${dates.length} copie${dates.length > 1 ? 's' : ''} sur le serveur, la dernière du ${dayLabel(dates[0])}.` : 'Aucune copie sur le serveur.'}</span>}
          </p>

          {mode === 'idle' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {enrolled ? (
                <>
                  <Button variant="tonal" onClick={sendNow} disabled={busy}><CloudUpload className="w-4 h-4" aria-hidden="true" /> Envoyer maintenant</Button>
                  <Button variant="outlined" onClick={() => { reset(); setMode('check'); }} disabled={busy}><KeyRound className="w-4 h-4" aria-hidden="true" /> Vérifier mon code</Button>
                  {hasCopies && <Button variant="outlined" onClick={() => { reset(); setMode('restore'); }} disabled={busy}><CloudDownload className="w-4 h-4" aria-hidden="true" /> Restaurer</Button>}
                  <Button variant="text" onClick={disable} disabled={busy}><Trash2 className="w-4 h-4" aria-hidden="true" /> Désactiver</Button>
                </>
              ) : (
                <>
                  <Button variant="tonal" onClick={startEnable} disabled={busy}><ShieldCheck className="w-4 h-4" aria-hidden="true" /> Activer</Button>
                  {hasCopies && <Button variant="outlined" onClick={() => { reset(); setMode('join'); }} disabled={busy}><KeyRound className="w-4 h-4" aria-hidden="true" /> J'ai déjà un code de secours</Button>}
                  {hasCopies && <Button variant="outlined" onClick={() => { reset(); setMode('restore'); }} disabled={busy}><CloudDownload className="w-4 h-4" aria-hidden="true" /> Restaurer</Button>}
                </>
              )}
            </div>
          )}

          {mode === 'newCode' && newCode && (
            <Notice tone="warning" className="mt-3 p-4!">
              <p className="text-sm font-medium">Votre code de secours</p>
              <p className="mt-2 font-code text-base sm:text-lg font-medium tracking-wider text-on-surface break-all select-all" data-testid="recovery-code">{newCode}</p>
              <p className="mt-2">
                Notez-le ou rangez-le dans un gestionnaire de mots de passe, <strong className="font-medium">hors de cet appareil</strong>. Il ne sera <strong className="font-medium">plus jamais affiché</strong> et n'est enregistré nulle part :
                sans lui, les copies de secours sont illisibles, pour vous comme pour le serveur.
                {hasCopies && ' Les copies déjà sur le serveur restent lisibles avec votre ancien code seulement.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outlined" onClick={copyCode}><Copy className="w-4 h-4" aria-hidden="true" /> {copied ? 'Copié' : 'Copier'}</Button>
                <DownloadCodeButton code={newCode} />
                <Button onClick={() => { setError(null); setMode('verify'); }} disabled={busy}>Je l'ai mis en lieu sûr</Button>
                <Button variant="text" onClick={reset} disabled={busy}>Annuler</Button>
              </div>
            </Notice>
          )}

          {mode === 'verify' && newCode && (
            <RecoveryCodeCheck code={newCode} busy={busy} onConfirmed={() => { void confirmSaved(); }}
              onShowAgain={() => setMode('newCode')} onCancel={reset} />
          )}

          {(mode === 'join' || mode === 'restore' || mode === 'check') && (
            <div className="mt-3 rounded-xl border border-outline-variant p-4 space-y-3">
              {mode === 'restore' && dates && (
                <div>
                  <label htmlFor="cloud-restore-date" className="block text-sm font-medium text-on-surface-variant mb-1.5">Copie à restaurer</label>
                  <select id="cloud-restore-date" value={restoreDate} onChange={e => setRestoreDate(e.target.value)}
                    className="w-full h-14 px-4 rounded-xs bg-transparent border border-outline text-base text-on-surface">
                    {dates.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}
                  </select>
                </div>
              )}
              <TextField label="Code de secours" value={codeInput} onChange={e => setCodeInput(e.target.value)} autoComplete="off" spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className="font-code" error={error ?? undefined}
                supporting={mode === 'join' ? 'Le code montré lors de l\'activation sur un autre appareil.'
                  : mode === 'check' ? 'Retapez-le depuis votre note. La vérification a lieu sur cet appareil ; le code n\'est pas envoyé.'
                  : 'Le déchiffrement a lieu sur cet appareil ; le code n\'est pas envoyé.'} />
              <div className="flex flex-wrap gap-2">
                {mode === 'check' ? <Button onClick={checkCode} disabled={busy || !codeInput.trim()} isLoading={busy}>Vérifier ce code</Button>
                  : mode === 'join'
                  ? <Button onClick={join} disabled={busy || !codeInput.trim()} isLoading={busy}>Activer avec ce code</Button>
                  : <Button onClick={restore} disabled={busy || !codeInput.trim() || !restoreDate}>{busy ? 'Déchiffrement…' : 'Déchiffrer et restaurer'}</Button>}
                <Button variant="text" onClick={reset} disabled={busy}>Annuler</Button>
              </div>
            </div>
          )}

          {error && mode !== 'join' && mode !== 'restore' && mode !== 'check' &&<p role="alert" className="mt-2 text-xs font-medium text-error">{error}</p>}
        </>
      )}
    </div>
  );
};

const deviceName = (host: string) =>
  host.includes('apple') ? 'iPhone / Mac' : host.includes('fcm') ? 'Android / Chrome' : host.includes('mozilla') ? 'Firefox' : host.includes('windows') ? 'Windows' : host;

/** Appareils qui reçoivent les notifications, dernière vérification du serveur, déconnexions. */
export const ServerSecurityPanel: React.FC<{
  discreet: boolean;
  onToggleDiscreet: (v: boolean) => void;
  confirm: (title: string, message: string, onOk: () => void | Promise<void>, danger?: boolean) => void;
  onSignedOutEverywhere: () => void;
}> = ({ discreet, onToggleDiscreet, confirm, onSignedOutEverywhere }) => {
  const toast = useToast();
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const backend = isBackendEnabled();
  const refresh = () => {
    if (!backend) return;
    listPushDevices().then(setDevices).catch(() => setDevices([]));
    getServerHealth().then(setHealth).catch(() => setHealth(null));
  };
  useEffect(refresh, [backend]);
  useCardSummary('devices', devices === null ? null : `${devices.length} appareil${devices.length > 1 ? 's' : ''} notifié${devices.length > 1 ? 's' : ''}`);
  useCardSummary('discreet', discreet ? 'Notifications discrètes' : 'Notifications avec montants');

  return (
    <div>
      <SwitchRow
        label="Notifications discrètes"
        hint="Aucun montant dans les notifications (salaire, restitution…) : rien de lisible sur l'écran verrouillé."
        checked={discreet}
        onChange={onToggleDiscreet}
      />

      {backend && (
        <>
          <div className="pt-5 mt-5 border-t border-outline-variant">
            <CardSubheading icon={Smartphone}>Appareils qui reçoivent les notifications</CardSubheading>
            {devices === null ? <Loader2 className="w-4 h-4 animate-spin mt-3 text-on-surface-variant" aria-label="Chargement" />
              : devices.length === 0 ? <p className="text-sm text-on-surface-variant mt-2">Aucun appareil.</p>
              : (
                <ul className="mt-2 divide-y divide-outline-variant">
                  {devices.map(d => (
                    <li key={d.id} className="flex items-center justify-between gap-2 py-1.5 text-sm text-on-surface">
                      <span>{deviceName(d.host)}
                        {d.current && <span className="ml-1 font-medium text-primary">(cet appareil)</span>}
                        {d.createdAt && <span className="text-on-surface-variant"> · depuis le {new Date(d.createdAt).toLocaleDateString('fr-FR')}</span>}
                      </span>
                      {!d.current && (
                        <IconButton label={`Retirer l'appareil ${d.host}`} icon={Trash2} tone="danger" className="-my-2"
                          onClick={async () => { await removePushDevice(d.id).catch(() => undefined); refresh(); }} />
                      )}
                    </li>
                  ))}
                </ul>
              )}

            {health && (
              <p className="mt-3 text-xs text-on-surface-variant flex items-center gap-2"><Activity className="w-4 h-4" aria-hidden="true" />
                {health.lastRunAt ? `Dernière vérification des rappels : ${new Date(health.lastRunAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${health.ok === false ? ' (en échec)' : ''}` : 'Les rappels n\'ont pas encore tourné.'}
              </p>
            )}
          </div>

          <ServerSessionsList confirm={confirm} onSignedOut={onSignedOutEverywhere} />

          <div className="pt-5 mt-5 border-t border-outline-variant">
            <CardSubheading>Sessions et données du serveur</CardSubheading>
            <Hint className="mt-1">Vos données financières restent sur votre Drive : le serveur ne garde que vos sessions, vos appareils, l'accès qui sert aux rappels et, si vous l'avez activée, la sauvegarde de secours chiffrée.</Hint>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outlined" onClick={() => confirm('Déconnecter tous les appareils ?', 'Toutes les sessions Pécule (téléphone, ordinateur…) seront fermées et plus aucune notification ne sera envoyée. Il faudra vous reconnecter partout.', async () => {
                try { await logoutAllDevices(); onSignedOutEverywhere(); } catch { toast?.({ message: 'Serveur injoignable, réessayez.', kind: 'error' }); }
              }, true)}><LogOut className="w-4 h-4" aria-hidden="true" /> Déconnecter tous les appareils</Button>
              <Button variant="text" className="text-error! hover:bg-error/8!" onClick={() => confirm('Supprimer mes données serveur ?', 'Le serveur efface tout de suite vos sessions, vos appareils et l\'accès Google qu\'il garde, puis révoque cet accès. Les notifications s\'arrêtent. Vos copies de secours chiffrées, s\'il y en a, sont effacées 7 jours plus tard : en vous reconnectant d\'ici là, vous pourrez annuler. Vos données financières restent sur votre Drive.', async () => {
                try { await deleteServerAccount(); onSignedOutEverywhere(); } catch { toast?.({ message: 'Serveur injoignable, réessayez.', kind: 'error' }); }
              }, true)}><Trash2 className="w-4 h-4" aria-hidden="true" /> Supprimer mes données serveur</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/** Modèle Gemini (sur cet appareil) : à changer si Google retire celui par défaut. */
export const GeminiModelField: React.FC = () => {
  const [value, setValue] = useState(getGeminiModelOverride());
  return (
    <TextField id="gemini-model" label="Modèle Gemini (facultatif)" value={value} placeholder={DEFAULT_GEMINI_MODEL} autoComplete="off" spellCheck={false}
      onChange={e => setValue(e.target.value)} onBlur={() => setGeminiModelOverride(value)}
      supporting="Laissez vide pour le modèle par défaut. Si Google retire un modèle, son message d'erreur indique le nom du remplaçant." />
  );
};
