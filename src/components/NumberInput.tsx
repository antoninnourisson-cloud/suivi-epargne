import React, { useEffect, useId, useState } from 'react';
import { parseFrenchNumber } from '../lib/numbers';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  suffix?: string; // ex: '€'
  min?: number;    // borne basse appliquée à la validation (ex: 0 pour un montant)
  id?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  describedBy?: string;
  invalid?: boolean;
  /** Décimales affichées hors saisie (2 par défaut ; 4 pour un taux comme 18,6 % ou 22,32 %). */
  decimals?: number;
}

const fmt = (n: number, decimals: number) => (isNaN(n) ? '' : n.toLocaleString('fr-FR', { maximumFractionDigits: decimals }));
/** Valeur brute à la française pour la saisie : « 0,186 », jamais « 0.186 ». */
const rawFrench = (n: number | undefined | null): string => (n === undefined || n === null || isNaN(n) ? '' : String(n).replace('.', ','));

/**
 * Champ numérique au format français : séparateurs de milliers hors saisie, valeur brute
 * pendant la saisie. Reste en `type="text"` : c'est `parseFrenchNumber` qui interprète la
 * saisie (la virgule décimale enregistrait 0 avec un champ « number »).
 *
 * La valeur est transmise à chaque frappe reconnue (« Entrée » valide donc tout de suite).
 * Une saisie non reconnue est signalée sous le champ, et la valeur précédente est gardée.
 */
export const NumberInput: React.FC<NumberInputProps> = ({ value, onChange, className, placeholder, suffix, min, id, inputRef, describedBy, invalid, decimals = 2 }) => {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState(rawFrench(value));
  const [badInput, setBadInput] = useState(false);
  const errorId = useId();

  useEffect(() => {
    if (!focused) setRaw(rawFrench(value));
  }, [value, focused]);

  const clamp = (n: number) => (min !== undefined && n < min ? min : n);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        aria-invalid={invalid || badInput || undefined}
        aria-describedby={[describedBy, badInput ? errorId : undefined].filter(Boolean).join(' ') || undefined}
        value={focused ? raw : (value || value === 0 ? fmt(value, decimals) : '')}
        placeholder={placeholder}
        onFocus={() => { setFocused(true); setRaw(value ? rawFrench(value) : ''); }}
        onChange={e => {
          const next = e.target.value;
          setRaw(next);
          const parsed = parseFrenchNumber(next);
          if (parsed !== null) { setBadInput(false); onChange(clamp(parsed)); }
          else if (next.trim() === '') { setBadInput(false); onChange(0); }
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parseFrenchNumber(raw);
          if (parsed === null) {
            // Champ vidé => 0 ; saisie non interprétable => la valeur précédente est gardée
            // (écraser un solde réel par 0 à cause d'une faute de frappe serait pire).
            setBadInput(raw.trim() !== '');
            onChange(raw.trim() === '' ? 0 : value);
            return;
          }
          setBadInput(false);
          onChange(clamp(parsed));
        }}
        className={`${className ?? ''} ${suffix ? 'pr-8' : ''}`}
      />
      {suffix ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-on-surface-variant text-sm font-medium">{suffix}</span>
      ) : null}
      {badInput && <p id={errorId} role="alert" className="text-xs font-medium text-error mt-1">Montant non reconnu : la valeur précédente est conservée.</p>}
    </div>
  );
};
