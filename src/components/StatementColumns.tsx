// « Colonnes du fichier » : étape de « Lire un relevé » quand Pécule n'est pas sûr des colonnes
// d'un CSV. Un menu par rôle (date, libellé, montant ou débit et crédit, solde facultatif) et
// un aperçu des trois premières lignes ; le reste du parcours est celui des autres relevés.
import React, { useId, useState } from 'react';
import { fieldClass } from './ui';
import type { CsvMapping, CsvTable } from '../lib/statementFiles';

interface Props {
  table: CsvTable;
  mapping: CsvMapping;
  onChange: (mapping: CsvMapping) => void;
}

export const StatementColumns: React.FC<Props> = ({ table, mapping, onChange }) => {
  const id = useId();
  const [two, setTwo] = useState(mapping.amount < 0 && (mapping.debit >= 0 || mapping.credit >= 0));
  const options = (none: string) => (
    <>
      <option value="-1">{none}</option>
      {table.header.map((h, i) => <option key={i} value={i}>{`${i + 1}. ${h || 'Sans titre'}`}</option>)}
    </>
  );
  const select = (key: keyof CsvMapping, label: string, none: string) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="block text-sm font-medium text-on-surface-variant mb-1.5">{label}</label>
      <select id={`${id}-${key}`} value={mapping[key]} onChange={e => onChange({ ...mapping, [key]: Number(e.target.value) })} className={fieldClass}>
        {options(none)}
      </select>
    </div>
  );
  const switchMode = (value: string) => {
    const nextTwo = value === 'two';
    setTwo(nextTwo);
    onChange(nextTwo ? { ...mapping, amount: -1 } : { ...mapping, debit: -1, credit: -1 });
  };
  const preview = table.rows.slice(0, 3);

  return (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        Pécule n'est pas sûr des colonnes de ce fichier. Indiquez à quoi sert chacune : <strong className="font-medium text-on-surface">rien n'est enregistré avant la relecture</strong>.
      </p>
      <div className="overflow-x-auto rounded-xl border border-outline-variant" tabIndex={0} role="region" aria-label="Aperçu des trois premières lignes du fichier">
        <table className="text-xs text-left min-w-full">
          <thead className="bg-surface-container">
            <tr>{table.header.map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium text-on-surface whitespace-nowrap">{`${i + 1}. ${h || 'Sans titre'}`}</th>)}</tr>
          </thead>
          <tbody>
            {preview.map((r, k) => (
              <tr key={k} className="border-t border-outline-variant">
                {r.map((c, i) => <td key={i} className="px-3 py-2 text-on-surface-variant whitespace-nowrap max-w-48 truncate">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {select('date', 'Date de l\'opération', 'Choisir une colonne')}
      {select('label', 'Libellé', 'Choisir une colonne')}
      <div>
        <label htmlFor={`${id}-mode`} className="block text-sm font-medium text-on-surface-variant mb-1.5">Les montants sont écrits dans</label>
        <select id={`${id}-mode`} value={two ? 'two' : 'one'} onChange={e => switchMode(e.target.value)} className={fieldClass}>
          <option value="one">Une colonne (dépenses avec un signe moins)</option>
          <option value="two">Deux colonnes : débit et crédit</option>
        </select>
      </div>
      {two ? (
        <>
          {select('debit', 'Débit (sorties d\'argent)', 'Aucune colonne')}
          {select('credit', 'Crédit (entrées d\'argent)', 'Aucune colonne')}
        </>
      ) : select('amount', 'Montant', 'Choisir une colonne')}
      {select('balance', 'Solde (facultatif)', 'Pas de colonne de solde')}
    </div>
  );
};
