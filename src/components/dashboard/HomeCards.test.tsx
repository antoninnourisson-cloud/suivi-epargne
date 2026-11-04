// @vitest-environment jsdom
// Accueil › Épargne de précaution : la jauge (livrets et comptes courants ÷ dépenses du mois)
// et la durée de survie venue du Pilotage, avec son propre chiffre (épargne disponible,
// placements compris ÷ charges fixes seules), épargne et base dites en toutes lettres.
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmergencyCard } from './HomeCards';
import { setDiscreetAmounts } from '../../lib/format';
import type { EmergencyFund } from '../../lib/planning';

afterEach(() => { cleanup(); setDiscreetAmounts(false); });

const nb = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');
const fund: EmergencyFund = {
  months: 3, monthlySpending: 1450, target: 4350, current: 14700, cashBuffer: 2175, missing: 0, pct: 100, reached: true,
  survival: { fixedCharges: 1050, savings: 14700, months: 14 },
};

describe('EmergencyCard', () => {
  it('une ligne de survie qui nomme son épargne et sa base (charges fixes seules)', () => {
    render(<EmergencyCard emergency={fund} />);
    expect(nb(screen.getByText(/^Sans revenu/).textContent)).toBe('Sans revenu, en ne payant que vos charges fixes (1 050 € par mois), votre épargne disponible, placements compris (14 700 €), tiendrait 1 an et 2 mois.');
  });

  it('sans charge fixe : pas de ligne ; mode discret : pas de montant', () => {
    render(<EmergencyCard emergency={{ ...fund, survival: undefined }} />);
    expect(screen.queryByText(/^Sans revenu/)).toBeNull();
    cleanup();
    setDiscreetAmounts(true);
    render(<EmergencyCard emergency={fund} />);
    expect(screen.getByText(/^Sans revenu/).textContent).not.toMatch(/\d\s?€/);
  });
});
