import { describe, it, expect } from 'vitest';
import { formatAxisEUR, maxAbs, durationLabel, describeEvolution, lastPointPerMonth, groupByInstitution, niceTicks } from './chartData';

const norm = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatAxisEUR', () => {
  it('écrit les euros en entier sous 10 000 €', () => {
    expect(norm(formatAxisEUR(1200, 2000))).toBe('1 200 €');
  });
  it('passe en k€ sur une grande échelle', () => {
    expect(norm(formatAxisEUR(12500, 30000))).toBe('12,5 k€');
    expect(norm(formatAxisEUR(0, 30000))).toBe('0 k€');
  });
});

describe('maxAbs', () => {
  it('ignore les valeurs non finies', () => {
    expect(maxAbs([1, -5, NaN, 3])).toBe(5);
    expect(maxAbs([])).toBe(0);
  });
});

describe('durationLabel', () => {
  it('compte en jours puis en mois', () => {
    expect(durationLabel('2026-01-01', '2026-01-02')).toBe('1 jour');
    expect(durationLabel('2026-01-01', '2026-01-21')).toBe('20 jours');
    expect(durationLabel('2025-10-01', '2026-10-01')).toBe('12 mois');
  });
  it('accepte les périodes AAAA-MM', () => {
    expect(durationLabel('2026-01', '2026-07')).toBe('6 mois');
    expect(durationLabel('mars', '2026-07')).toBe('');
  });
});

describe('describeEvolution', () => {
  it('écrit le départ, l’arrivée, la durée et l’écart', () => {
    expect(norm(describeEvolution('Votre épargne', 18000, 24400, '2026-04-01', '2026-10-01')))
      .toBe('Votre épargne est passée de 18 000 € à 24 400 € en 6 mois (+6 400 €).');
  });
  it('accorde au masculin et gère la stabilité', () => {
    expect(norm(describeEvolution('Votre net', 2000, 2000, '2026-01', '2026-03', 'm')))
      .toBe('Votre net est resté à 2 000 € en 2 mois.');
    expect(norm(describeEvolution('Vos charges', 900, 1000, '2026-01', '2026-03', 'fp')))
      .toBe('Vos charges sont passées de 900 € à 1 000 € en 2 mois (+100 €).');
  });
});

describe('lastPointPerMonth', () => {
  it('garde le dernier point de chaque mois', () => {
    const pts = [{ date: '2026-01-05' }, { date: '2026-01-31' }, { date: '2026-02-10' }];
    expect(lastPointPerMonth(pts).map(p => p.date)).toEqual(['2026-01-31', '2026-02-10']);
  });
});

describe('groupByInstitution', () => {
  it('regroupe sans tenir compte de la casse ni des espaces, trié décroissant', () => {
    const accounts = [
      { institution: 'BPVF', v: 100 },
      { institution: ' bpvf  ', v: 50 },
      { institution: 'Boursorama', v: 500 },
      { institution: '', v: 10 },
    ];
    expect(groupByInstitution(accounts, a => a.v)).toEqual([
      { name: 'Boursorama', value: 500 },
      { name: 'BPVF', value: 150 },
      { name: 'Sans établissement', value: 10 },
    ]);
  });
});

describe('niceTicks', () => {
  it('choisit un pas rond qui couvre le maximum', () => {
    expect(niceTicks(33550)).toEqual([0, 10000, 20000, 30000, 40000]);
    expect(niceTicks(24400)).toEqual([0, 5000, 10000, 15000, 20000, 25000]);
    expect(niceTicks(2100)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});
