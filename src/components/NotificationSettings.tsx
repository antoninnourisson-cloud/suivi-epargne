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
import { Button } from './ui';
import { Hint, Notice, useCardSummary } from './settings/SettingsCard';

const STATE_SUMMARY: Record<PushState | 'loading', string | null> = {
  loading: null,
  unavailable: null,
  enabled: 'Activées sur cet appareil',
  disabled: 'Désactivées sur cet appareil',
  denied: 'Bloquées par le navigateur',
  unsupported: 'Non disponibles sur cet appareil',
};

// `paydayDay` / `onOpenPayday` : raccourci vers le réglage du rappel de paie, qui vit dans
// le Pilotage (on le cherchait ici).
export const NotificationSettings: React.FC<{ paydayDay?: number; onOpenPayday?: () => void; prefs?: NotificationPrefs; onChangePrefs?: (p: NotificationPrefs) => void }> = ({ paydayDay, onOpenPayday, prefs = {}, onChangePrefs }) => {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const refresh = () => getPushState().then(setState).catch(() => setState('unsupported'));
  useEffect(() => { void refresh(); }, []);

  const off = onChangePrefs ? NOTIFICATION_CATEGORIES.filter(c => prefs[c.id] === false).length : 0;
  const summary = STATE_SUMMARY[state];
  useCardSummary('push', summary && off > 0 ? `${summary} · ${off} type${off > 1 ? 's' : ''} coupé${off > 1 ? 's' : ''}` : summary);

  if (!isBackendEnabled()) return null;

  const run = async (action: () => Promise<void>, okText?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (okText) setMessage({ kind: 'ok', text: okText });
    } catch (e) {
      const code = (e as { message?: unknown } | null | undefined)?.message;
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
      void refresh();
    }
  };

  const test = () => run(async () => {
    const ok = await sendTestPush();
    if (!ok) throw new Error('TEST_FAILED');
  }, 'Notification de test envoyée — elle devrait apparaître dans quelques secondes.');

  return (
    <div className="space-y-4">
      <Hint>
        Recevez les rappels même app fermée : jour de paie, abonnements, échéances récurrentes, révision des taux réglementés, bilan du mois, dons à déclarer, soldes non actualisés… Vérification une fois par jour ; chaque rappel n’est envoyé qu’une fois. Réglage propre à cet appareil.
      </Hint>

      {state === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-on-surface-variant" aria-label="Chargement" />}

      {state === 'unsupported' && (
        <Notice tone="warning" icon={AlertTriangle}>
          {isIosOutsideHomeScreen()
            ? 'Sur iPhone, les notifications ne fonctionnent que dans l’app installée : Partager → « Sur l’écran d’accueil », puis ouvrez-la depuis l’icône.'
            : 'Ce navigateur ne prend pas en charge les notifications push (ou l’app n’est pas encore installée comme application).'}
        </Notice>
      )}

      {state === 'denied' && (
        <Notice tone="warning" icon={AlertTriangle}>
          Les notifications sont bloquées pour ce site. Réautorisez-les dans les réglages du navigateur (icône à gauche de l’adresse), puis revenez ici.
        </Notice>
      )}

      {(state === 'disabled' || state === 'enabled') && (
        <div className="flex flex-wrap gap-2">
          {state === 'disabled' ? (
            <Button onClick={() => run(enablePush, 'Notifications activées sur cet appareil.')} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Bell className="w-4 h-4" aria-hidden="true" />} Activer sur cet appareil
            </Button>
          ) : (
            <>
              <Button variant="tonal" onClick={test} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />} Envoyer un test
              </Button>
              <Button variant="text" onClick={() => run(disablePush, 'Notifications désactivées sur cet appareil.')} disabled={busy}>
                <BellOff className="w-4 h-4" aria-hidden="true" /> Désactiver
              </Button>
            </>
          )}
        </div>
      )}

      {onOpenPayday && (
        <p className="text-sm text-on-surface flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Rappel du jour de paie : <span className="font-medium">{paydayDay ? `le ${paydayDay} du mois` : 'désactivé'}</span></span>
          <Button variant="text" onClick={onOpenPayday} className="-ml-3 sm:ml-0">Modifier dans le Pilotage</Button>
        </p>
      )}

      {onChangePrefs && (
        <fieldset className="pt-4 border-t border-outline-variant">
          <legend className="text-sm font-medium text-on-surface mb-2">Types de notifications (tous vos appareils)</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {NOTIFICATION_CATEGORIES.map(c => (
              <label key={c.id} className="flex items-start gap-3 text-sm text-on-surface cursor-pointer">
                <input type="checkbox" className="mt-0.5 w-[18px] h-[18px] shrink-0 accent-indigo-600" checked={prefs[c.id] !== false}
                  onChange={e => onChangePrefs({ ...prefs, [c.id]: e.target.checked })} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {message && (
        <p role="status" className={`text-xs font-medium flex items-start gap-2 ${message.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-error'}`}>
          {message.kind === 'ok' ? <CheckCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />}
          {message.text}
        </p>
      )}
    </div>
  );
};
