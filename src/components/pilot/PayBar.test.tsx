// @vitest-environment jsdom
// La barre de la paie : une image (role="img") dont le libellé dit tous les montants, une
// légende lisible (<dl>), le prévu d'une part coupée, ce qui manque pour les virements fixes,
// et le mode discret.
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PayBar } from './PayBar';
import { payBarParts } from '../../lib/pilotView';
import { allocatePay } from '../../lib/payDistribution';
import { DISCREET_AMOUNT, setDiscreetAmounts } from '../../lib/format';

afterEach(() => { cleanup(); setDiscreetAmounts(false); });

const usual = { expectedPay: 2000, fixed: 1050, projects: 100, startBalance: 400 };
const nb = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ').trim();

describe('PayBar', () => {
  it('image accessible et légende des quatre parts, dans l\'ordre des priorités', () => {
    const bar = payBarParts(allocatePay({ received: 2000, before: 30, ...usual }));
    const { container } = render(<PayBar bar={bar} notes={{ savings: 'dont 30 € de reste du mois dernier' }} />);
    const img = screen.getByRole('img');
    expect(nb(img.getAttribute('aria-label'))).toBe('Répartition de 2 030 € : virements fixes 1 050 €, épargne 480 €, épargne projets 100 €, plaisir 400 €.');
    const terms = [...container.querySelectorAll('dt')].map(d => d.textContent);
    expect(terms).toEqual(['Virements fixes', 'Épargne', 'Épargne projets', 'Plaisir']);
    const values = [...container.querySelectorAll('dd')].map(d => nb(d.textContent));
    expect(values).toEqual(['1 050 €', '480 €dont 30 € de reste du mois dernier', '100 €', '400 €']);
    // Un segment par part non nulle, sans pointillé.
    expect(img.children).toHaveLength(4);
    expect(img.querySelector('.border-dashed')).toBeNull();
    expect(screen.queryByText(/Il manque/)).toBeNull();
  });

  it('part coupée : son prévu en pointillé et dans la légende ; fixes non couverts : ce qu\'il manque', () => {
    const cut = payBarParts(allocatePay({ received: 1850, before: 30, ...usual }));
    render(<PayBar bar={cut} />);
    expect(nb(screen.getByText(/prévu/).textContent)).toBe('(prévu 400 €)');
    expect(screen.getByRole('img').querySelectorAll('.border-dashed')).toHaveLength(1);
    cleanup();
    render(<PayBar bar={payBarParts(allocatePay({ received: 900, ...usual }))} />);
    expect(nb(screen.getByText(/Il manque/).textContent)).toBe('Il manque 150 € pour les virements fixes.');
  });

  it('rien à répartir : une barre vide ; mode discret : aucun montant visible', () => {
    render(<PayBar bar={{ parts: [], total: 0, missingFixed: 0, label: 'Rien à répartir.' }} />);
    expect(screen.getByRole('img', { name: 'Rien à répartir.' }).children).toHaveLength(1);
    cleanup();
    setDiscreetAmounts(true);
    const { container } = render(<PayBar bar={payBarParts(allocatePay({ received: 2000, ...usual }))} />);
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).toContain(DISCREET_AMOUNT);
  });
});
