// ================================================
// FILE: src/components/NotificationSettings.tsx
// Activation des notifications push sur CET appareil (réglage propre au navigateur).
// N'apparaît que si l'app est reliée au serveur (VITE_BACKEND_URL).
// ================================================
import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Send, AlertTriangle, CheckCircle } from 'lucide-react';
import { isBackendEnabled } from '../services/backendService';
import { getPushState, enablePush, disablePush, sendTestPush, isIosOutsideHomeScreen, PushState } from '../services/pushService';

export const NotificationSettings: React.FC = () => {
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
          ? 'Autorisation refusée. Tu peux la réactiver dans les réglages du navigateur pour ce site.'
          : code === 'SESSION_EXPIRED'
            ? 'Session expirée : reconnecte-toi puis réessaie.'
            : 'L’opération a échoué. Vérifie ta connexion et réessaie.',
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
      <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-2">
        Reçois les rappels même app fermée : échéances récurrentes, révision des taux réglementés, intérêts parentaux de décembre, soldes non actualisés depuis un mois. Vérification une fois par jour ; chaque rappel n’est envoyé qu’une fois. Réglage propre à cet appareil.
      </p>

      {state === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}

      {state === 'unsupported' && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {isIosOutsideHomeScreen()
            ? 'Sur iPhone, les notifications ne fonctionnent que dans l’app installée : Partager → « Sur l’écran d’accueil », puis ouvre-la depuis l’icône.'
            : 'Ce navigateur ne prend pas en charge les notifications push (ou l’app n’est pas encore installée comme application).'}
        </p>
      )}

      {state === 'denied' && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Les notifications sont bloquées pour ce site. Réautorise-les dans les réglages du navigateur (icône à gauche de l’adresse), puis reviens ici.
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

      {message && (
        <p className={`text-xs font-bold flex items-start gap-2 ${message.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          {message.kind === 'ok' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {message.text}
        </p>
      )}
    </div>
  );
};
