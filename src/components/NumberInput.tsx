import React, { useEffect, useState } from 'react';
import { parseFrenchNumber } from '../lib/numbers';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  suffix?: string; // ex: '€'
  min?: number;    // borne basse appliquée à la validation (ex: 0 pour un montant)
}

const fmt = (n: number) => (isNaN(n) ? '' : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

/**
 * Input numérique affichant les montants avec séparateurs de milliers (espace, format FR)
 * en dehors du focus, et la valeur brute éditable pendant la saisie.
 *
 * Reste en `type="text"` en permanence : c'est `parseFrenchNumber` qui interprète la saisie,
 * pas le navigateur. Voir le commentaire de cette fonction pour le bug de perte de données
 * que ça corrige (la virgule décimale enregistrait 0).
 */
export const NumberInput: React.FC<NumberInputProps> = ({ value, onChange, className, placeholder, suffix, min }) => {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState(String(value ?? ''));

  useEffect(() => {
    if (!focused) setRaw(String(value ?? ''));
  }, [value, focused]);

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        value={focused ? raw : (value || value === 0 ? fmt(value) : '')}
        placeholder={placeholder}
        onFocus={() => { setFocused(true); setRaw(value ? String(value) : ''); }}
        onChange={e => setRaw(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const parsed = parseFrenchNumber(raw);
          if (parsed === null) {
            // Champ explicitement vidé => 0 (intention claire). Saisie non interprétable
            // => on RESTAURE la valeur précédente : écraser un solde réel par 0 à cause
            // d'une faute de frappe est la pire issue possible ici.
            onChange(raw.trim() === '' ? 0 : value);
            return;
          }
          onChange(min !== undefined && parsed < min ? min : parsed);
        }}
        className={className}
      />
      {!focused && suffix && value ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400 dark:text-slate-500 text-xs font-bold">{suffix}</span>
      ) : null}
    </div>
  );
};
