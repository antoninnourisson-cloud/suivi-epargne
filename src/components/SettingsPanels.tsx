// Panneaux de Paramètres liés à la sécurité et à la sauvegarde : copies mensuelles Drive,
// sauvegarde de secours chiffrée, appareils et données gardés par le serveur, modèle Gemini.
// Ils s'affichent dans les cartes repliables de l'écran (voir settings/SettingsCard) et y
// signalent leur état pour le résumé de la carte (useCardSummary).
import React, { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, Smartphone, Loader2, Trash2, LogOut, Activity, ShieldCheck, Copy, CloudUpload, CloudDownload, KeyRound } from 'lucide-react';
import type { DriveBackup } from '../services/googleDriveService';
import type { GlobalAppData } from '../types';
import {
  isCloudBackupAvailable, getDeviceEnrollment, listServerBackups, readStatus, generateRecoveryCode, enableWithNewCode,
  enableWithExistingCode, uploadNow, decryptServerBackup, disableAndDeleteServerCopies, failureCode, FAILURE_MESSAGES,
  type CloudBackupStatus,
} from '../services/cloudBackup';
import { validateImport } from '../lib/schema';
import { Button, TextField } from './ui';
import {
  isBackendEnabled, listPushDevices, removePushDevice, logoutAllDevices, deleteServerAccount, getServerHealth,
  PushDevice, ServerHealth,
} from '../services/backendService';
import { DEFAULT_GEMINI_MODEL, getGeminiModelOverride, setGeminiModelOverride } from '../services/geminiService';
import { useToast } from './Toast';
import { CardSubheading, Hint, Notice, useCardSummary } from './settings/SettingsCard';
import { SwitchRow } from './settings/fields';

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** Copies mensuelles du fichier sur Drive, restaurables en un clic (après confirmation). */
export const DriveBackupsPanel: React.FC<{
  list: () => Promise<DriveBackup[]>;
  restore: (id: string) => Promise<void>;
  confirm: (title: string, message: string, onOk: () => void | Promise<void>) => void;
}> = ({ list, restore, confirm }) => {
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
                <button type="button" disabled={busy}
                  className="h-8 px-3 inline-flex items-center rounded-sm border border-outline text-sm font-medium text-on-surface-variant hover:bg-on-surface/8 disabled:opacity-40 capitalize"
                  onClick={() => confirm(
                    `Revenir à la copie de ${monthLabel(b.month)} ?`,
                    'Toutes vos données actuelles seront remplacées par cette copie, puis enregistrées sur Drive. Pensez à exporter avant si vous avez un doute.',
                    async () => {
                      setBusy(true);
                      try { await restore(b.id); toast?.({ message: `Copie de ${monthLabel(b.month)} restaurée`, kind: 'success' }); }
                      catch { toast?.({ message: 'Copie illisible : rien n\'a été remplacé.', kind: 'error' }); }
                      finally { setBusy(false); }
                    },
                  )}>{monthLabel(b.month)}</button>
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

type CloudMode = 'idle' | 'newCode' | 'join' | 'restore';

/**
 * Sauvegarde de secours chiffrée de bout en bout, gardée par le serveur (8 copies). Le code
 * de secours n'est montré qu'UNE fois ; la restauration passe par le même contrôle qu'un
 * import de fichier (validateImport, puis migrate dans importData).
 */
export const CloudBackupPanel: React.FC<{
  getData: () => GlobalAppData;
  onImport: (file: File) => Promise<boolean>;
  confirm: (title: string, message: string, onOk: () => void | Promise<void>, danger?: boolean) => void;
}> = ({ getData, onImport, confirm }) => {
  const toast = useToast();
  const [available] = useState(isCloudBackupAvailable);
  const [enrolled, setEnrolled] = useState<{ enabledAt: string } | null | undefined>(undefined);
  const [dates, setDates] = useState<string[] | null>(null);
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
    listServerBackups().then(d => { setDates(d); setRestoreDate(prev => (prev && d.includes(prev) ? prev : d[0] ?? '')); })
      .catch(() => setDates([]));
  }, []);
  useEffect(() => { if (available) refresh(); }, [available, refresh]);
  useCardSummary('cloud', !available || enrolled === undefined ? null : enrolled ? 'Secours chiffré activé' : 'Secours chiffré désactivé');

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
      'Toutes vos données actuelles (comptes, mouvements, objectifs, fiches de paie, réglages) seront remplacées par cette copie, puis enregistrées sur Drive. Pensez à exporter avant si vous avez un doute.',
      async () => {
        const ok = await onImport(new File([json], `pecule-secours-${restoreDate}.json`, { type: 'application/json' }));
        if (ok) { reset(); toast?.({ message: `Copie de secours du ${label} restaurée`, kind: 'success' }); }
        else toast?.({ message: 'Copie refusée : rien n\'a été remplacé.', kind: 'error' });
      }, true);
  });
  const disable = () => confirm('Désactiver la sauvegarde de secours ?',
    'Toutes les copies chiffrées gardées par le serveur seront effacées, et cet appareil n\'en enverra plus. Votre fichier Drive et ses copies mensuelles ne changent pas.',
    () => run(async () => {
      const n = await disableAndDeleteServerCopies();
      reset();
      toast?.({ message: `Sauvegarde de secours désactivée (${n} copie${n > 1 ? 's' : ''} effacée${n > 1 ? 's' : ''})`, kind: 'success' });
    }), true);

  const hasCopies = !!dates && dates.length > 0;

  return (
    <div className="pt-5 mt-5 border-t border-outline-variant" data-testid="cloud-backup-panel">
      <CardSubheading icon={ShieldCheck}>Sauvegarde de secours chiffrée</CardSubheading>
      <Hint className="mt-1">
        Une copie de vos données, chiffrée sur cet appareil avant l'envoi, gardée par le serveur de Pécule au cas où le fichier Drive serait abîmé ou supprimé.
        Le serveur ne peut pas la lire : seul votre <strong className="font-medium text-on-surface">code de secours</strong> permet de la déchiffrer. Envoi automatique au plus une fois par semaine si vos données ont changé ; les 8 dernières copies sont gardées.
      </Hint>

      {enrolled === undefined ? <Loader2 className="w-4 h-4 animate-spin mt-3 text-on-surface-variant" aria-label="Chargement" /> : (
        <>
          <p role="status" className="mt-3 text-sm text-on-surface">
            {enrolled
              ? <>Activée sur cet appareil. {status.lastUploadAt ? `Dernier envoi : ${dateTimeLabel(status.lastUploadAt)}.` : 'Aucun envoi pour l\'instant.'}
                {status.lastError && status.lastErrorAt && (!status.lastUploadAt || status.lastErrorAt > status.lastUploadAt)
                  && <span className="block text-error">Échec du dernier essai ({dateTimeLabel(status.lastErrorAt)}) : {FAILURE_MESSAGES[status.lastError as keyof typeof FAILURE_MESSAGES] ?? status.lastError}</span>}</>
              : 'Pas activée sur cet appareil.'}
            {dates && <span className="block text-on-surface-variant">{hasCopies ? `${dates.length} copie${dates.length > 1 ? 's' : ''} sur le serveur, la dernière du ${dayLabel(dates[0])}.` : 'Aucune copie sur le serveur.'}</span>}
          </p>

          {mode === 'idle' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {enrolled ? (
                <>
                  <Button variant="tonal" onClick={sendNow} disabled={busy}><CloudUpload className="w-4 h-4" aria-hidden="true" /> Envoyer maintenant</Button>
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
              <p className="mt-2 font-mono text-base sm:text-lg font-medium tracking-wider text-on-surface break-all select-all" data-testid="recovery-code">{newCode}</p>
              <p className="mt-2">
                Notez-le ou rangez-le dans un gestionnaire de mots de passe, <strong className="font-medium">hors de cet appareil</strong>. Il ne sera <strong className="font-medium">plus jamais affiché</strong> et n'est enregistré nulle part :
                sans lui, les copies de secours sont illisibles, pour vous comme pour le serveur.
                {hasCopies && ' Les copies déjà sur le serveur restent lisibles avec votre ancien code seulement.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outlined" onClick={copyCode}><Copy className="w-4 h-4" aria-hidden="true" /> {copied ? 'Copié' : 'Copier'}</Button>
                <Button onClick={confirmSaved} disabled={busy}>Je l'ai mis en lieu sûr</Button>
                <Button variant="text" onClick={reset} disabled={busy}>Annuler</Button>
              </div>
            </Notice>
          )}

          {(mode === 'join' || mode === 'restore') && (
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
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className="font-mono" error={error ?? undefined}
                supporting={mode === 'join' ? 'Le code montré lors de l\'activation sur un autre appareil.' : 'Le déchiffrement a lieu sur cet appareil ; le code n\'est pas envoyé.'} />
              <div className="flex flex-wrap gap-2">
                {mode === 'join'
                  ? <Button onClick={join} disabled={busy || !codeInput.trim()} isLoading={busy}>Activer avec ce code</Button>
                  : <Button onClick={restore} disabled={busy || !codeInput.trim() || !restoreDate}>{busy ? 'Déchiffrement…' : 'Déchiffrer et restaurer'}</Button>}
                <Button variant="text" onClick={reset} disabled={busy}>Annuler</Button>
              </div>
            </div>
          )}

          {error && mode !== 'join' && mode !== 'restore' && <p role="alert" className="mt-2 text-xs font-medium text-error">{error}</p>}
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
                        {d.current && <span className="ml-1 font-medium text-indigo-700 dark:text-indigo-300">(cet appareil)</span>}
                        {d.createdAt && <span className="text-on-surface-variant"> · depuis le {new Date(d.createdAt).toLocaleDateString('fr-FR')}</span>}
                      </span>
                      {!d.current && (
                        <button type="button" className="p-2 -m-1 rounded-full text-on-surface-variant hover:text-error hover:bg-error/8" aria-label={`Retirer l'appareil ${d.host}`}
                          onClick={async () => { await removePushDevice(d.id).catch(() => undefined); refresh(); }}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
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

          <div className="pt-5 mt-5 border-t border-outline-variant">
            <CardSubheading>Sessions et données du serveur</CardSubheading>
            <Hint className="mt-1">Vos données financières restent sur votre Drive : le serveur ne garde que votre session, vos appareils et l'accès qui sert aux rappels.</Hint>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outlined" onClick={() => confirm('Déconnecter tous les appareils ?', 'Toutes les sessions Pécule (téléphone, ordinateur…) seront fermées et plus aucune notification ne sera envoyée. Il faudra vous reconnecter partout.', async () => {
                try { await logoutAllDevices(); onSignedOutEverywhere(); } catch { toast?.({ message: 'Serveur injoignable, réessayez.', kind: 'error' }); }
              }, true)}><LogOut className="w-4 h-4" aria-hidden="true" /> Déconnecter tous les appareils</Button>
              <Button variant="text" className="text-error! hover:bg-error/8!" onClick={() => confirm('Supprimer mes données serveur ?', 'Le serveur efface votre session, vos appareils et l\'accès Google qu\'il garde, puis révoque cet accès. Vos données financières restent sur votre Drive. Les notifications s\'arrêtent.', async () => {
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
