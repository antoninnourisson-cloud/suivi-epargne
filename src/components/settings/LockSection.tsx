// Verrou de l'appareil (biométrie et/ou code PIN) : réglage 100 % local à cet appareil
// (localStorage), donc en dehors du circuit onSave/Drive du reste des Paramètres — une
// empreinte ou un code enregistrés sur ce téléphone n'ont aucun sens sur un autre appareil.
import React, { useEffect, useState } from 'react';
import { Fingerprint, Hash } from 'lucide-react';
import {
  isLockAvailable, isBiometricEnabled, isPinEnabled, enableLock, disableBiometric, enablePin, disablePin, getLastLockReset,
  getLockDelayMs, setLockDelayMs, LOCK_DELAYS_MS, type LockDelayMs,
} from '../../services/appLockService';
import { Button, TextField } from '../ui';
import { Hint, useCardSummary } from './SettingsCard';
import { SwitchRow } from './fields';
import { fieldClass } from '../ui/TextField';

// Délai avant verrouillage : mesuré depuis le passage en arrière-plan (voir useAppLock).
const DELAY_LABEL: Record<LockDelayMs, string> = {
  0: 'Immédiatement',
  60_000: 'Après 1 minute',
  300_000: 'Après 5 minutes',
  900_000: 'Après 15 minutes',
};

export const LockSection: React.FC = () => {
  const [delay, setDelay] = useState<LockDelayMs>(getLockDelayMs);
  const changeDelay = (ms: LockDelayMs) => { setLockDelayMs(ms); setDelay(getLockDelayMs()); };

  const [lockAvailable, setLockAvailable] = useState(false);
  const [biometricOn, setBiometricOn] = useState(isBiometricEnabled());
  const [lockError, setLockError] = useState<string | null>(null);
  useEffect(() => { isLockAvailable().then(setLockAvailable).catch(() => setLockAvailable(false)); }, []);

  const toggleBiometric = async () => {
    setLockError(null);
    if (biometricOn) {
      disableBiometric();
      setBiometricOn(false);
      return;
    }
    try {
      await enableLock();
      // Relu : un nouveau verrou termine une réinitialisation en attente (anciennes méthodes retirées).
      setBiometricOn(isBiometricEnabled());
      setPinOn(isPinEnabled());
    } catch {
      setLockError("Activation annulée ou échouée. Réessayez, ou vérifiez que Face ID / l'empreinte est configuré sur cet appareil.");
    }
  };

  const [pinOn, setPinOn] = useState(isPinEnabled());
  const [pinDraft, setPinDraft] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [settingPin, setSettingPin] = useState(false);

  const submitPinSetup = async () => {
    setPinError(null);
    if (!/^\d{6,8}$/.test(pinDraft)) {
      setPinError('Le code doit faire entre 6 et 8 chiffres (un code court se devine en quelques minutes si quelqu’un copie les données du navigateur).');
      return;
    }
    try {
      await enablePin(pinDraft);
    } catch {
      setPinError('Le code n\'a pas pu être enregistré sur cet appareil. Réessayez.');
      return;
    }
    setPinOn(isPinEnabled());
    setBiometricOn(isBiometricEnabled());
    setSettingPin(false);
    setPinDraft('');
  };

  const togglePin = () => {
    if (pinOn) {
      disablePin();
      setPinOn(false);
      return;
    }
    setSettingPin(true);
  };

  // Date du dernier retrait par « Code oublié » : repérer un retrait qu'on n'aurait pas fait.
  const lastResetIso = getLastLockReset();
  const lastResetDate = lastResetIso ? new Date(lastResetIso) : null;
  const lastReset = lastResetDate && !Number.isNaN(lastResetDate.getTime())
    ? lastResetDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const method = biometricOn && pinOn ? 'Biométrie et code PIN' : biometricOn ? 'Biométrie activée' : pinOn ? 'Code PIN activé' : null;
  useCardSummary('lock', method ? `${method} · ${DELAY_LABEL[delay].toLowerCase()}` : 'Aucun verrou');

  return (
    <div className="space-y-5">
      <Hint>
        Verrouillez l'accès sur cet appareil (réglage propre à ce navigateur, jamais synchronisé sur Drive). Les deux méthodes peuvent être actives en même temps. Le verrou protège contre une personne qui prendrait votre appareil déverrouillé. En cas de code oublié, le retrait se demande sur l'écran de verrouillage : il est possible 24 heures plus tard, après une reconnexion à Google, et déverrouiller Pécule entre-temps annule la demande. Une personne qui peut ouvrir votre compte Google sur cet appareil peut aussi voir vos données sur Drive.
      </Hint>

      {lastReset && (
        <p className="text-sm text-on-surface-variant">
          Dernier retrait du verrou avec « Code oublié » : le {lastReset}. Si ce n'était pas vous, vérifiez la sécurité de votre compte Google.
        </p>
      )}

      {!lockAvailable ? (
        <p className="text-sm text-on-surface-variant flex items-start gap-2"><Fingerprint className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> Face ID / empreinte / Windows Hello non disponible sur cet appareil ou ce navigateur — seul le code PIN est proposé.</p>
      ) : (
        <SwitchRow
          label="Verrou biométrique"
          hint="Face ID / empreinte / Windows Hello à chaque ouverture de l'app."
          checked={biometricOn}
          onChange={() => { void toggleBiometric(); }}
          error={lockError}
        />
      )}

      <div className="pt-5 border-t border-outline-variant">
        <SwitchRow
          label={<span className="inline-flex items-center gap-1.5"><Hash className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Code PIN</span>}
          hint="6 à 8 chiffres, en repli si la biométrie n'est pas disponible ou par préférence."
          checked={pinOn || settingPin}
          onChange={() => {
            if (settingPin && !pinOn) { setSettingPin(false); setPinDraft(''); setPinError(null); return; }
            togglePin();
          }}
        >
          {settingPin && (
            <form className="mt-3 flex flex-wrap items-start gap-2" onSubmit={e => { e.preventDefault(); void submitPinSetup(); }}>
              <label htmlFor="pin-setup" className="sr-only">Nouveau code PIN</label>
              <input
                id="pin-setup"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                autoComplete="new-password"
                value={pinDraft}
                onChange={e => setPinDraft(e.target.value.replace(/\D/g, ''))}
                placeholder="Nouveau code (6 à 8 chiffres)"
                aria-invalid={pinError ? true : undefined}
                className={`${fieldClass} flex-1 min-w-48 h-12! tracking-widest`}
                autoFocus
              />
              <div className="flex gap-2 py-1">
                <Button type="submit">Définir</Button>
                <Button type="button" variant="text" onClick={() => { setSettingPin(false); setPinDraft(''); setPinError(null); }}>Annuler</Button>
              </div>
            </form>
          )}
          {pinError && <p role="alert" className="text-xs font-medium text-error mt-2">{pinError}</p>}
        </SwitchRow>
      </div>

      {(biometricOn || pinOn) && (
        <div className="pt-5 border-t border-outline-variant">
          <TextField id="lock-delay" label="Verrouiller" className="max-w-xs"
            supporting="Après un passage en arrière-plan (autre appli, écran éteint). À l'ouverture de Pécule, le verrou est toujours demandé ; choisir un fichier depuis Pécule ne verrouille pas."
            render={({ id, className, describedBy }) => (
              <select id={id} aria-describedby={describedBy} className={className} value={delay}
                onChange={e => changeDelay(Number(e.target.value) as LockDelayMs)}>
                {LOCK_DELAYS_MS.map(ms => <option key={ms} value={ms}>{DELAY_LABEL[ms]}</option>)}
              </select>
            )} />
        </div>
      )}
    </div>
  );
};
