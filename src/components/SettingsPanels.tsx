// Panneaux de Paramètres liés à la sécurité et à la sauvegarde : copies mensuelles Drive,
// appareils et données gardés par le serveur, modèle Gemini.
import React, { useEffect, useState } from 'react';
import { ArchiveRestore, Smartphone, ShieldOff, Loader2, Trash2, LogOut, Activity, Bot } from 'lucide-react';
import type { DriveBackup } from '../services/googleDriveService';
import {
  isBackendEnabled, listPushDevices, removePushDevice, logoutAllDevices, deleteServerAccount, getServerHealth,
  PushDevice, ServerHealth,
} from '../services/backendService';
import { DEFAULT_GEMINI_MODEL, getGeminiModelOverride, setGeminiModelOverride } from '../services/geminiService';
import { useToast } from './Toast';

const card = 'bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700';
const h3 = 'font-bold text-slate-800 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2 flex items-center gap-2';
const btn = 'flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-xl font-bold text-xs disabled:opacity-50';
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

/** Copies mensuelles du fichier sur Drive, restaurables en un clic (après confirmation). */
export const DriveBackupsPanel: React.FC<{
  list: () => Promise<DriveBackup[]>;
  restore: (id: string) => Promise<void>;
  confirm: (title: string, message: string, onOk: () => void) => void;
}> = ({ list, restore, confirm }) => {
  const toast = useToast();
  const [items, setItems] = useState<DriveBackup[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { list().then(setItems).catch(() => setItems([])); }, [list]);
  return (
    <div className="mt-5">
      <p className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase flex items-center gap-2"><ArchiveRestore className="w-4 h-4" aria-hidden="true" /> Copies mensuelles sur Drive</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Une copie complète est créée au premier enregistrement de chaque mois ; les 12 dernières sont gardées.</p>
      {items === null ? <Loader2 className="w-4 h-4 animate-spin mt-2 text-slate-500" aria-label="Chargement" />
        : items.length === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Pas encore de copie : la première sera créée au prochain enregistrement.</p>
        : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {items.map(b => (
              <li key={b.id}>
                <button disabled={busy} className={btn} onClick={() => confirm(
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

/** Appareils qui reçoivent les notifications, dernière vérification du serveur, déconnexions. */
export const ServerSecurityPanel: React.FC<{
  discreet: boolean;
  onToggleDiscreet: (v: boolean) => void;
  confirm: (title: string, message: string, onOk: () => void, danger?: boolean) => void;
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

  return (
    <div className={card}>
      <h3 className={h3}><ShieldOff className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Appareils et confidentialité</h3>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={discreet} onChange={e => onToggleDiscreet(e.target.checked)} className="mt-1 w-4 h-4 accent-indigo-600" />
        <span>
          <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">Notifications discrètes</span>
          <span className="block text-xs text-slate-600 dark:text-slate-300">Aucun montant dans les notifications (salaire, restitution…) : rien de lisible sur l'écran verrouillé.</span>
        </span>
      </label>

      {backend && (
        <>
          <p className="mt-5 text-xs font-black text-slate-600 dark:text-slate-300 uppercase flex items-center gap-2"><Smartphone className="w-4 h-4" aria-hidden="true" /> Appareils qui reçoivent les notifications</p>
          {devices === null ? <Loader2 className="w-4 h-4 animate-spin mt-2 text-slate-500" aria-label="Chargement" />
            : devices.length === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Aucun appareil.</p>
            : (
              <ul className="mt-2 space-y-1">
                {devices.map(d => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-200">
                    <span>{d.host.includes('apple') ? 'iPhone / Mac' : d.host.includes('fcm') ? 'Android / Chrome' : d.host.includes('mozilla') ? 'Firefox' : d.host.includes('windows') ? 'Windows' : d.host}
                      {d.current && <strong className="ml-1 text-indigo-700 dark:text-indigo-300">(cet appareil)</strong>}
                      {d.createdAt && <span className="text-slate-500 dark:text-slate-400"> · depuis le {new Date(d.createdAt).toLocaleDateString('fr-FR')}</span>}
                    </span>
                    {!d.current && (
                      <button className="p-2 text-slate-500 hover:text-rose-600" aria-label={`Retirer l'appareil ${d.host}`}
                        onClick={async () => { await removePushDevice(d.id).catch(() => undefined); refresh(); }}><Trash2 className="w-4 h-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}

          {health && (
            <p className="mt-4 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2"><Activity className="w-4 h-4" aria-hidden="true" />
              {health.lastRunAt ? `Dernière vérification des rappels : ${new Date(health.lastRunAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${health.ok === false ? ' (en échec)' : ''}` : 'Les rappels n\'ont pas encore tourné.'}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button className={btn} onClick={() => confirm('Déconnecter tous les appareils ?', 'Toutes les sessions Pécule (téléphone, ordinateur…) seront fermées et plus aucune notification ne sera envoyée. Il faudra vous reconnecter partout.', async () => {
              try { await logoutAllDevices(); onSignedOutEverywhere(); } catch { toast?.({ message: 'Serveur injoignable, réessayez.', kind: 'error' }); }
            }, true)}><LogOut className="w-4 h-4" aria-hidden="true" /> Déconnecter tous les appareils</button>
            <button className={`${btn} text-rose-700 dark:text-rose-300`} onClick={() => confirm('Supprimer mes données serveur ?', 'Le serveur efface votre session, vos appareils et l\'accès Google qu\'il garde, puis révoque cet accès. Vos données financières restent sur votre Drive. Les notifications s\'arrêtent.', async () => {
              try { await deleteServerAccount(); onSignedOutEverywhere(); } catch { toast?.({ message: 'Serveur injoignable, réessayez.', kind: 'error' }); }
            }, true)}><Trash2 className="w-4 h-4" aria-hidden="true" /> Supprimer mes données serveur</button>
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
    <div className="mt-3">
      <label htmlFor="gemini-model" className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase flex items-center gap-1"><Bot className="w-3.5 h-3.5" aria-hidden="true" /> Modèle Gemini (facultatif)</label>
      <input id="gemini-model" value={value} placeholder={DEFAULT_GEMINI_MODEL} onChange={e => setValue(e.target.value)} onBlur={() => setGeminiModelOverride(value)}
        className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-mono text-xs text-slate-800 dark:text-slate-100" />
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Laissez vide pour le modèle par défaut. Si Google retire un modèle, son message d'erreur indique le nom du remplaçant.</p>
    </div>
  );
};
