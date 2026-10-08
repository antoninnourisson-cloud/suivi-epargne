// Verrou de l'appareil (biométrie et/ou code PIN) : réglage 100 % local à cet appareil
// (localStorage), donc en dehors du circuit onSave/Drive du reste des Paramètres — une
// empreinte ou un code enregistrés sur ce téléphone n'ont aucun sens sur un autre appareil.
import React, { useEffect, useState } from 'react';
import { Fingerprint, Hash } from 'lucide-react';
import { isLockAvailable, isBiometricEnabled, isPinEnabled, enableLock, disableBiometric, enablePin, disablePin } from '../../services/appLockService';
import { Button } from '../ui';
import { Hint, useCardSummary } from './SettingsCard';
import { SwitchRow } from './fields';
import { fieldClass } from '../ui/TextField';

export const LockSection: React.FC = () => {
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
      setBiometricOn(true);
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
    await enablePin(pinDraft);
    setPinOn(true);
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

  useCardSummary('lock', biometricOn && pinOn ? 'Biométrie et code PIN' : biometricOn ? 'Biométrie activée' : pinOn ? 'Code PIN activé' : 'Aucun verrou');

  return (
    <div className="space-y-5">
      <Hint>
        Verrouillez l'accès sur cet appareil (réglage propre à ce navigateur, jamais synchronisé sur Drive). Les deux méthodes peuvent être actives en même temps. Protège contre un accès occasionnel — pas une garantie cryptographique absolue sur un site sans serveur.
      </Hint>

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
    </div>
  );
};
