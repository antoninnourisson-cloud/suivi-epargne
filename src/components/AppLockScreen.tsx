// ================================================
// FILE: src/components/AppLockScreen.tsx
// Écran plein-cran affiché tant que le verrou de cet appareil (biométrie et/ou PIN) n'a
// pas été validé (voir src/services/appLockService.ts pour la nature exacte — et les
// limites — de ce verrou).
// ================================================
import React, { useEffect, useState } from 'react';
import { Fingerprint, Loader2, AlertTriangle, Delete } from 'lucide-react';
import { isBiometricEnabled, isPinEnabled, verifyBiometric, verifyPin } from '../services/appLockService';

interface AppLockScreenProps {
  onUnlock: () => void;
}

const PIN_MAX_LENGTH = 8;

export const AppLockScreen: React.FC<AppLockScreenProps> = ({ onUnlock }) => {
  const biometricOn = isBiometricEnabled();
  const pinOn = isPinEnabled();
  const [checkingBiometric, setCheckingBiometric] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [checkingPin, setCheckingPin] = useState(false);

  const attemptBiometric = async () => {
    setCheckingBiometric(true);
    setFailed(false);
    const ok = await verifyBiometric();
    setCheckingBiometric(false);
    if (ok) onUnlock();
    else setFailed(true);
  };

  // Tentative automatique à l'affichage si la biométrie est configurée : Face ID/Touch ID
  // se déclenchent immédiatement la plupart du temps, évitant un clic superflu. Le PIN
  // reste disponible en repli si elle échoue ou est annulée.
  useEffect(() => { if (biometricOn) attemptBiometric(); }, []);

  const submitPin = async (value: string) => {
    setCheckingPin(true);
    setPinError(false);
    const ok = await verifyPin(value);
    setCheckingPin(false);
    if (ok) { onUnlock(); return; }
    setPinError(true);
    setPin('');
  };

  const pressDigit = (d: string) => {
    if (checkingPin || pin.length >= PIN_MAX_LENGTH) return;
    const next = pin + d;
    setPin(next);
    setPinError(false);
  };
  const pressBackspace = () => setPin(p => p.slice(0, -1));
  const pressValidate = () => { if (pin.length >= 4) submitPin(pin); };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/30">
          <Fingerprint className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-2">Suivi Épargne verrouillé</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-6">Vérifie ton identité pour accéder à tes données.</p>

        {biometricOn && (
          <>
            {failed && (
              <div className="mb-4 flex items-center gap-2 justify-center text-sm font-bold text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Vérification annulée ou échouée.
              </div>
            )}
            <button
              onClick={attemptBiometric}
              disabled={checkingBiometric}
              className="w-full flex justify-center items-center gap-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-4 rounded-xl font-bold transition-colors"
            >
              {checkingBiometric ? <><Loader2 className="w-4 h-4 animate-spin" /> Vérification…</> : <><Fingerprint className="w-4 h-4" /> Déverrouiller</>}
            </button>
          </>
        )}

        {biometricOn && pinOn && (
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase">ou code PIN</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          </div>
        )}

        {pinOn && (
          <div>
            <div className="flex justify-center gap-2 mb-4">
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <div key={i} className={`w-3 h-3 rounded-full ${i < pin.length ? (pinError ? 'bg-rose-500' : 'bg-indigo-600') : 'bg-slate-200 dark:bg-slate-700'}`} />
              ))}
            </div>
            {pinError && (
              <p className="mb-3 text-xs font-bold text-rose-600 dark:text-rose-400">Code incorrect.</p>
            )}
            <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto">
              {['1','2','3','4','5','6','7','8','9'].map(d => (
                <button key={d} onClick={() => pressDigit(d)} disabled={checkingPin} className="py-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-black text-lg disabled:opacity-50">{d}</button>
              ))}
              <button onClick={pressBackspace} disabled={checkingPin} className="py-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 flex items-center justify-center disabled:opacity-50"><Delete className="w-4 h-4" /></button>
              <button onClick={() => pressDigit('0')} disabled={checkingPin} className="py-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-black text-lg disabled:opacity-50">0</button>
              <button onClick={pressValidate} disabled={checkingPin || pin.length < 4} className="py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black disabled:opacity-40">{checkingPin ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'OK'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
