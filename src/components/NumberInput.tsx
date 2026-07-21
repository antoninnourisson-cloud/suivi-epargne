import React, { useEffect, useState } from 'react';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  suffix?: string; // ex: '€'
}

const fmt = (n: number) => (isNaN(n) ? '' : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

/**
 * Input numérique affichant les montants avec séparateurs de milliers (espace, format FR)
 * en dehors du focus, et la valeur brute éditable pendant la saisie.
 */
export const NumberInput: React.FC<NumberInputProps> = ({ value, onChange, className, placeholder, suffix }) => {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState(String(value ?? ''));

  useEffect(() => {
    if (!focused) setRaw(String(value ?? ''));
  }, [value, focused]);

  return (
    <div className="relative">
      <input
        type={focused ? 'number' : 'text'}
        inputMode="decimal"
        value={focused ? raw : (value || value === 0 ? fmt(value) : '')}
        placeholder={placeholder}
        onFocus={() => { setFocused(true); setRaw(value ? String(value) : ''); }}
        onChange={e => setRaw(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const parsed = parseFloat(raw.replace(',', '.'));
          onChange(isNaN(parsed) ? 0 : parsed);
        }}
        className={className}
      />
      {!focused && suffix && value ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400 dark:text-slate-500 text-xs font-bold">{suffix}</span>
      ) : null}
    </div>
  );
};
