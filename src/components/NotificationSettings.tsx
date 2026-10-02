// ================================================
// FILE: src/components/NotificationSettings.tsx
// Activation des notifications push sur CET appareil (réglage propre au navigateur).
// N'apparaît que si l'app est reliée au serveur (VITE_BACKEND_URL).
// ================================================
import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Send, AlertTriangle, CheckCircle } from 'lucide-react';
import { isBackendEnabled } from '../services/backendService';
import { NOTIFICATION_CATEGORIES, NotificationPrefs } from '../lib/notificationPrefs';
import { getPushState, enablePush, disablePush, sendTestPush, isIosOutsideHomeScreen, PushState } from '../services/pushService';

// `paydayDay` / `onOpenPayday` : raccourci vers le réglage du rappel de paie, qui vit dans
// le Pilotage (on le cherchait ici).
export const NotificationSettings: React.FC<{ paydayDay?: number; onOpenPayday?: () => void; prefs?: NotificationPrefs; onChangePrefs?: (p: NotificationPrefs) => void }> = ({ paydayDay, onOpenPayday, prefs = {}, onChangePrefs }) => {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const refresh = () => getPushState().then(setState).catch(() => setState('unsupported'));
  useEffect(() => { refresh(); }, []);

  if (!isBackendEnabled()) return null;

  const run = async (action: () => Promise<void>, okText?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (okText) setMessage({ kind: 'ok', text: okText });
    } catch (e: any) {
      const code = e?.message;
      setMessage({
        kind: 'error',
        text: code === 'PERMISSION_DENIED'
          ? 'Autorisation refusée. Vous pouvez la réactiver dans les réglages du navigateur pour ce site.'
          : code === 'SESSION_EXPIRED'
            ? 'Session expirée : reconnectez-vous puis réessayez.'
            : 'L’opération a échoué. Vérifiez votre connexion et réessayez.',
      });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const test = () => run(async () => {
    const ok = await sendTestPush();
    if (!ok) throw new Error('TEST_FAILED');
  }, 'Notification de test envoyée — elle devrait apparaître dans quelques secondes.');

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 lg:col-span-2 space-y-4">
      <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-2 border-b border-slate-200 dark:border-slate-700 pb-2 flex items-center gap-2">
        <Bell className="w-4 h-4 text-indigo-600" /> Notifications
      </h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-2">
        Recevez les rappels même app fermée : jour de paie, abonnements, échéances récurrentes, révision des taux réglementés, bilan du mois, dons à déclarer, soldes non actualisés… Vérification une fois par jour ; chaque rappel n’est envoyé qu’une fois. Réglage propre à cet appareil.
      </p>

      {state === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}

      {state === 'unsupported' && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {isIosOutsideHomeScreen()
            ? 'Sur iPhone, les notifications ne fonctionnent que dans l’app installée : Partager → « Sur l’écran d’accueil », puis ouvrez-la depuis l’icône.'
            : 'Ce navigateur ne prend pas en charge les notifications push (ou l’app n’est pas encore installée comme application).'}
        </p>
      )}

      {state === 'denied' && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Les notifications sont bloquées pour ce site. Réautorisez-les dans les réglages du navigateur (icône à gauche de l’adresse), puis revenez ici.
        </p>
      )}

      {(state === 'disabled' || state === 'enabled') && (
        <div className="flex flex-wrap gap-2">
          {state === 'disabled' ? (
            <button onClick={() => run(enablePush, 'Notifications activées sur cet appareil.')} disabled={busy} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-sm">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} Activer sur cet appareil
            </button>
          ) : (
            <>
              <button onClick={test} disabled={busy} className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Envoyer un test
              </button>
              <button onClick={() => run(disablePush, 'Notifications désactivées sur cet appareil.')} disabled={busy} className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-rose-600 px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-50">
                <BellOff className="w-4 h-4" /> Désactiver
              </button>
            </>
          )}
        </div>
      )}

      {onOpenPayday && (
        <p className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
          <span>Rappel du jour de paie : <b>{paydayDay ? `le ${paydayDay} du mois` : 'désactivé'}</b></span>
          <button type="button" onClick={onOpenPayday} className="font-bold text-indigo-600 dark:text-indigo-300 hover:underline">Modifier dans le Pilotage</button>
        </p>
      )}

      {onChangePrefs && (
        <fieldset className="mt-2 border-t border-slate-200 dark:border-slate-700 pt-4">
          <legend className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase mb-2">Types de notifications (tous vos appareils)</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {NOTIFICATION_CATEGORIES.map(c => (
              <label key={c.id} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" className="mt-1 w-4 h-4 accent-indigo-600" checked={prefs[c.id] !== false}
                  onChange={e => onChangePrefs({ ...prefs, [c.id]: e.target.checked })} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {message && (
        <p className={`text-xs font-bold flex items-start gap-2 ${message.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          {message.kind === 'ok' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {message.text}
        </p>
      )}
    </div>
  );
};
