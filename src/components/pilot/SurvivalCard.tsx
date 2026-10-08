// Durée de survie : combien de temps l'épargne disponible couvre les charges fixes, sans
// revenu. Le niveau est écrit en toutes lettres, pas seulement porté par la couleur.
import React from 'react';
import { Hourglass } from 'lucide-react';
import { Card, StatTile } from '../ui';
import { formatEUR } from '../../lib/format';

export interface Survival {
  infinite: boolean;
  years: number;
  months: number;
  days: number;
  monthlyBurn: number;
  totalMonths: number;
}

const level = (totalMonths: number) =>
  totalMonths < 3
    ? { text: 'Réserve courte', tone: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200' }
    : totalMonths < 6
      ? { text: 'Réserve moyenne', tone: 'bg-tertiary-container text-on-tertiary-container' }
      : { text: 'Réserve confortable', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200' };

export const SurvivalCard: React.FC<{ survival: Survival }> = ({ survival: s }) => {
  const value = s.infinite ? <><span aria-hidden="true">∞</span><span className="sr-only">illimitée</span></> : (
    <>
      {s.years > 0 && <>{s.years} an{s.years > 1 ? 's' : ''} </>}
      {s.months} mois
      {s.years === 0 && s.days > 0 && <> {s.days} j</>}
    </>
  );
  const l = s.infinite ? null : level(s.totalMonths);
  return (
    <Card title="Durée de survie" icon={Hourglass}>
      <StatTile
        label="Sans revenu, votre épargne disponible tiendrait"
        value={value}
        delta={l && <span className={`inline-flex items-center h-7 px-2.5 rounded-sm text-xs font-medium ${l.tone}`}>{l.text}</span>}
        hint={s.infinite ? 'Aucune charge fixe renseignée' : `Avec ${formatEUR(s.monthlyBurn)} de charges fixes par mois`}
      />
    </Card>
  );
};
