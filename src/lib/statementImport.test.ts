import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../types';
import {
  balanceOnlyByDefault, buildImportItems, guessAccountType, initialChoice, isISODay, isInterestLabel, labelSimilarity, maskAccountNumbers, matchScore,
  normalizeLabel, olderThanBalance, previewAccountImport, proposeMapping, reviewMovements, sanitizeStatement, statementClosingDate,
  statementConsistencyGap, STATEMENT_LIMITS, type StatementData,
} from './statementImport';
import { importStatement } from './commands';

const account = (over: Partial<SavingsAccount> & Pick<SavingsAccount, 'id' | 'name' | 'type'>): SavingsAccount => ({
  institution: 'Banque Démo', totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...over,
});
const livretA = account({ id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000 });
const courant = account({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, totalAmount: 3900, ownedAmount: 3900 });
const ldds = account({ id: 'ldds', name: 'LDDS', type: AccountType.LDDS, totalAmount: 3000, ownedAmount: 3000 });

describe('isISODay', () => {
  it('accepte un jour qui existe, refuse le reste', () => {
    expect(isISODay('2026-02-28')).toBe(true);
    expect(isISODay('2028-02-29')).toBe(true);
    expect(isISODay('2026-02-29')).toBe(false);
    expect(isISODay('2026-13-01')).toBe(false);
    expect(isISODay('2026-00-10')).toBe(false);
    expect(isISODay('2026-01-00')).toBe(false);
    expect(isISODay('1999-12-31')).toBe(false);
    expect(isISODay('2101-01-01')).toBe(false);
    expect(isISODay('15/10/2026')).toBe(false);
    expect(isISODay(20261015)).toBe(false);
    expect(isISODay(undefined)).toBe(false);
  });
});

describe('maskAccountNumbers', () => {
  it("retire l'IBAN et réduit les longs numéros à leurs 4 derniers chiffres", () => {
    expect(maskAccountNumbers('Livret A FR76 3000 6000 0112 3456 7890 189')).toBe('Livret A');
    expect(maskAccountNumbers('Compte de dépôt n° 0012345678')).toBe('Compte de dépôt n° ···5678');
    expect(maskAccountNumbers('Compte 123 45 678 9')).toBe('Compte ···6789');
    expect(maskAccountNumbers('Livret A')).toBe('Livret A');
  });
  it('libellé : seules les suites de 9 chiffres ou plus sont masquées', () => {
    expect(maskAccountNumbers('CB CARREFOUR 12345', 9)).toBe('CB CARREFOUR 12345');
    expect(maskAccountNumbers('VIR DE M DUPONT 98765432101', 9)).toBe('VIR DE M DUPONT ···2101');
  });
});

describe('sanitizeStatement', () => {
  it('garde un relevé lisible : dates, montants, sens, numéros masqués, opérations triées', () => {
    const s = sanitizeStatement({
      bank: '  Banque   Démo ', periodStart: '2026-09-01', periodEnd: '2026-09-30',
      accounts: [{
        name: 'LIVRET A n° 0012345678', numberEnd: 'xx 5678', openingBalance: 100.004, closingBalance: 250, closingDate: '2026-09-30',
        movements: [
          { date: '2026-09-20', label: 'VIR RECU 98765432101', amount: 100, direction: 'CREDIT' },
          { date: '2026-09-05', label: '  ', amount: 50, direction: 'CREDIT' },
          { date: '2026-09-10', label: 'Retrait', amount: 0, direction: 'DEBIT' },
          { date: '2026-09-31', label: 'Date fausse', amount: 3, direction: 'DEBIT' },
          { date: '2026-09-11', label: 'Sens inconnu', amount: 3 },
          { date: '2026-09-12', label: 'Montant texte', amount: '2 050,00', direction: 'DEBIT' },
          { date: '2026-09-13', label: 'Aberrant', amount: STATEMENT_LIMITS.amount * 2, direction: 'DEBIT' },
          { date: '2026-09-14', label: 'Négatif', amount: -4, direction: 'DEBIT' },
          'pas un objet',
        ],
      }],
    });
    expect(s.bank).toBe('Banque Démo');
    expect(s.periodStart).toBe('2026-09-01');
    expect(s.periodEnd).toBe('2026-09-30');
    expect(s.accounts).toHaveLength(1);
    const a = s.accounts[0];
    expect(a.name).toBe('LIVRET A n° ···5678');
    expect(a.numberEnd).toBe('5678');
    expect(a.openingBalance).toBe(100);
    expect(a.closingBalance).toBe(250);
    expect(a.closingDate).toBe('2026-09-30');
    expect(a.movements).toEqual([
      { date: '2026-09-05', label: 'Opération', amount: 50, type: 'IN' },
      { date: '2026-09-20', label: 'VIR RECU ···2101', amount: 100, type: 'IN' },
    ]);
    expect(a.ignored).toBe(7);
  });

  it('écarte un compte sans solde ni opération lisible, et une réponse qui n\'est pas un relevé', () => {
    expect(sanitizeStatement(null)).toEqual({ bank: undefined, periodStart: undefined, periodEnd: undefined, accounts: [] });
    expect(sanitizeStatement({ accounts: 'non' }).accounts).toEqual([]);
    expect(sanitizeStatement({ accounts: [null, [], { name: 'Vide', movements: [] }] }).accounts).toEqual([]);
  });

  it('nomme un compte sans intitulé, ignore un numéro trop court et des dates invalides', () => {
    const s = sanitizeStatement({ periodEnd: '2026-02-30', accounts: [{ closingBalance: -12.5, numberEnd: 7, closingDate: 'hier', movements: 'non' }] });
    expect(s.periodEnd).toBeUndefined();
    expect(s.accounts[0]).toEqual({ name: 'Compte 1', numberEnd: undefined, openingBalance: undefined, closingBalance: -12.5, closingDate: undefined, movements: [], ignored: 0 });
    expect(sanitizeStatement({ accounts: [{ name: 'X', numberEnd: 1234, closingBalance: 1 }] }).accounts[0].numberEnd).toBe('1234');
  });

  it('borne le nombre de comptes et d\'opérations (le surplus est compté comme écarté)', () => {
    const many = Array.from({ length: STATEMENT_LIMITS.accounts + 3 }, (_, i) => ({ name: `C${i}`, closingBalance: i }));
    expect(sanitizeStatement({ accounts: many }).accounts).toHaveLength(STATEMENT_LIMITS.accounts);
    const moves = Array.from({ length: STATEMENT_LIMITS.movements + 5 }, () => ({ date: '2026-01-02', amount: 1, direction: 'DEBIT' }));
    const a = sanitizeStatement({ accounts: [{ name: 'X', movements: moves }] }).accounts[0];
    expect(a.movements).toHaveLength(STATEMENT_LIMITS.movements);
    expect(a.ignored).toBe(5);
  });
});

describe('rapprochement', () => {
  it('normalise les libellés et reconnaît le type de compte nommé', () => {
    expect(normalizeLabel("  Livret d'Épargne Populaire ")).toBe('livret d epargne populaire');
    expect(guessAccountType('LIVRET A ···1234')).toBe(AccountType.LIVRET_A);
    expect(guessAccountType('Livret Développement Durable')).toBe(AccountType.LDDS);
    expect(guessAccountType("Livret d'épargne populaire")).toBe(AccountType.LEP);
    expect(guessAccountType('Compte de dépôts')).toBe(AccountType.COMPTE_COURANT);
    expect(guessAccountType('Compte sur livret')).toBe(AccountType.LIVRET_BANCAIRE);
    expect(guessAccountType('Plan Épargne Logement')).toBe(AccountType.PEL);
    expect(guessAccountType('Mon épargne')).toBeUndefined();
  });

  it('note la ressemblance : nom, type nommé, banque, type contraire', () => {
    expect(matchScore({ name: 'Livret A' }, livretA)).toBe(4);
    expect(matchScore({ name: 'Livret A' }, livretA, 'Banque Démo')).toBe(5);
    expect(matchScore({ name: 'LIVRET A ···1234' }, livretA)).toBe(4);
    expect(matchScore({ name: 'Compte de dépôt' }, courant)).toBe(3);
    // Un autre type est explicitement nommé : jamais proposé.
    expect(matchScore({ name: 'LDDS' }, livretA)).toBe(0);
    // « Livret » seul : un livret bancaire, faible ressemblance.
    expect(matchScore({ name: 'Compte sur livret' }, account({ id: 'lb', name: 'Épargne', type: AccountType.LIVRET_BANCAIRE }))).toBe(2);
    expect(matchScore({ name: 'Mon épargne' }, livretA, 'Banque Démo')).toBe(0);
    // Même nom, même si le type nommé diffère du type enregistré.
    expect(matchScore({ name: 'Livret A' }, account({ id: 'x', name: 'Livret A', type: AccountType.AUTRE }))).toBe(4);
    expect(matchScore({ name: 'Livret A' }, account({ id: 'x', name: '', type: AccountType.LIVRET_A, institution: '' }), 'Banque')).toBe(3);
  });

  it('propose un compte par compte du relevé, chacun une fois, au plus proche du solde', () => {
    const data: StatementData = {
      bank: 'Banque Démo',
      accounts: [
        { name: 'Compte de dépôt', closingBalance: 3087.6, movements: [], ignored: 0 },
        { name: 'Livret A', closingBalance: 15350, movements: [], ignored: 0 },
        { name: 'Livret Jeune', closingBalance: 800, movements: [], ignored: 0 },
      ],
    };
    expect(proposeMapping(data, [livretA, courant, ldds])).toEqual(['cc', 'la', undefined]);
    // Deux livrets A : le solde le plus proche l'emporte, l'autre reste libre.
    const la2 = { ...livretA, id: 'la2', name: 'Livret A Alice', totalAmount: 200, institution: '' };
    const two: StatementData = { accounts: [{ name: 'Livret A', closingBalance: 210, movements: [], ignored: 0 }, { name: 'Livret A', movements: [], ignored: 0 }] };
    expect(proposeMapping(two, [{ ...livretA, name: 'Épargne', institution: '' }, la2])).toEqual(['la2', 'la']);
  });

  it("ouvert depuis la fiche d'un compte, un relevé d'un seul compte va sur ce compte", () => {
    const one: StatementData = { accounts: [{ name: 'Mon épargne', closingBalance: 1, movements: [], ignored: 0 }] };
    expect(proposeMapping(one, [livretA, ldds], 'ldds')).toEqual(['ldds']);
    expect(proposeMapping(one, [livretA, ldds], 'disparu')).toEqual([undefined]);
  });
});

describe('reviewMovements', () => {
  const withMoves = account({
    id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, balanceCheckedAt: '2026-09-10',
    movements: [
      { id: 'init', date: '2026-01-01', amount: 100, label: 'Solde initial', type: 'IN', tag: 'initial' },
      { id: 'p', date: '2026-09-15', amount: 50, label: 'Part des parents', type: 'IN', kind: 'parental' },
      { id: 'e1', date: '2026-09-16', amount: 320, label: 'Épargne du mois', type: 'IN' },
      { id: 'e2', date: '2026-09-25', amount: 80, label: 'Retrait vacances', type: 'OUT' },
      { id: 'bad', date: 'jamais', amount: 12, label: 'Date illisible', type: 'IN' },
    ],
  });

  it('repère doublons, opérations déjà comprises dans le dernier solde, intérêts', () => {
    const r = reviewMovements({
      movements: [
        { date: '2026-09-17', label: 'VIR EPARGNE DU MOIS', amount: 320, type: 'IN' },
        { date: '2026-09-17', label: 'VIR EPARGNE DU MOIS', amount: 320, type: 'IN' },
        { date: '2026-09-05', label: 'Ancien', amount: 10, type: 'OUT' },
        { date: '2026-09-15', label: 'Parents', amount: 50, type: 'IN' },
        { date: '2026-09-30', label: 'INTERETS CREDITEURS', amount: 12.3, type: 'IN' },
        // Retrait saisi 6 jours plus tôt : libellés différents, hors de la fenêtre courte.
        { date: '2026-10-01', label: 'CB HOTEL', amount: 80, type: 'OUT' },
        { date: '2026-09-28', label: 'Montant illisible côté app', amount: 12, type: 'IN' },
      ],
    }, withMoves);
    expect(r.map(m => m.status)).toEqual(['duplicate', 'new', 'already-counted', 'new', 'new', 'new', 'new']);
    expect(r[0].matched).toEqual({ date: '2026-09-16', label: 'Épargne du mois' });
    expect(r[0].selected).toBe(false);
    expect(r[1].selected).toBe(true);
    expect(r[2].selected).toBe(false);
    expect(r[4].interest).toBe(true);
    expect(r[3].interest).toBe(false);
  });

  it('élargit la fenêtre quand les libellés se ressemblent', () => {
    const r = reviewMovements({ movements: [{ date: '2026-10-01', label: 'Retrait vacances CB', amount: 80, type: 'OUT' }] }, withMoves);
    expect(r[0].status).toBe('duplicate');
  });

  it('compte courant : rien de coché par défaut (seul le solde est mis à jour)', () => {
    const r = reviewMovements({ movements: [{ date: '2026-10-01', label: 'CB', amount: 8, type: 'OUT' }] }, courant);
    expect(r[0]).toMatchObject({ status: 'new', selected: false });
  });

  it('mesure la ressemblance des libellés', () => {
    expect(labelSimilarity('Épargne du mois', 'VIR EPARGNE DU MOIS')).toBeCloseTo(2 / 3);
    expect(labelSimilarity('a b', 'Épargne')).toBe(0);
    expect(isInterestLabel('Intérêts acquis 2026')).toBe(true);
    expect(isInterestLabel('INTERET')).toBe(true);
    expect(isInterestLabel('Virement')).toBe(false);
  });
});

describe('contrôles et aperçu', () => {
  it('vérifie le relevé lui-même : ancien solde + opérations = nouveau solde', () => {
    const moves = [{ date: '2026-09-02', label: 'a', amount: 100, type: 'IN' as const }, { date: '2026-09-03', label: 'b', amount: 30.5, type: 'OUT' as const }];
    expect(statementConsistencyGap({ openingBalance: 1000, closingBalance: 1069.5, movements: moves })).toBe(0);
    expect(statementConsistencyGap({ openingBalance: 1000, closingBalance: 1100, movements: moves })).toBe(30.5);
    expect(statementConsistencyGap({ closingBalance: 1100, movements: moves })).toBeNull();
  });

  it('date du nouveau solde : celle du relevé, sinon la fin de période, sinon la dernière opération ; jamais après aujourd\'hui', () => {
    const moves = [{ date: '2026-09-20', label: 'a', amount: 1, type: 'IN' as const }];
    expect(statementClosingDate({ closingDate: '2026-09-30', movements: moves }, { periodEnd: '2026-09-29' }, '2026-10-22')).toBe('2026-09-30');
    expect(statementClosingDate({ movements: moves }, { periodEnd: '2026-09-29' }, '2026-10-22')).toBe('2026-09-29');
    expect(statementClosingDate({ movements: moves }, {}, '2026-10-22')).toBe('2026-09-20');
    expect(statementClosingDate({ movements: [] }, {}, '2026-10-22')).toBe('2026-10-22');
    expect(statementClosingDate({ closingDate: '2026-12-31', movements: [] }, {}, '2026-10-22')).toBe('2026-10-22');
  });

  it("annonce l'écart restant et refuse un solde sous la part des parents", () => {
    const sel = [{ amount: 150, type: 'IN' as const }];
    expect(previewAccountImport(livretA, 15350, sel)).toEqual({ movementsTotal: 150, remainingGap: 0, belowParental: false });
    expect(previewAccountImport(livretA, 6000, [])).toEqual({ movementsTotal: 0, remainingGap: -9200, belowParental: true });
    expect(previewAccountImport(livretA, undefined, sel)).toEqual({ movementsTotal: 150, remainingGap: null, belowParental: false });
  });

  it('prépare la demande : opérations cochées, solde si demandé, compte choisi une seule fois', () => {
    const data: StatementData = {
      periodEnd: '2026-09-30',
      accounts: [
        { name: 'Livret A', closingBalance: 15350, movements: [], ignored: 0 },
        { name: 'Livret A bis', closingBalance: 1, movements: [], ignored: 0 },
        { name: 'Compte', closingBalance: 3000, movements: [], ignored: 0 },
        { name: 'Rien', closingBalance: 5, movements: [], ignored: 0 },
        { name: 'Ignoré', closingBalance: 5, movements: [], ignored: 0 },
      ],
    };
    const mv = (label: string, interest = false) => ({ date: '2026-09-20', label, amount: 10, type: 'IN' as const, status: 'new' as const, interest, selected: true });
    const items = buildImportItems(data, [
      { accountId: 'la', updateBalance: true, selected: [true, false, true], movements: [mv('a'), mv('b'), mv('Intérêts', true)] },
      { accountId: 'la', updateBalance: true, selected: [], movements: [] },
      { accountId: 'cc', updateBalance: true, selected: [], movements: [] },
      { accountId: 'ldds', updateBalance: false, selected: [false], movements: [mv('c')] },
      { updateBalance: true, selected: [], movements: [] },
    ], '2026-10-22');
    expect(items).toEqual([
      { accountId: 'la', date: '2026-09-30', closingBalance: 15350, movements: [
        { date: '2026-09-20', label: 'a', amount: 10, type: 'IN' },
        { date: '2026-09-20', label: 'Intérêts', amount: 10, type: 'IN', interest: true },
      ] },
      { accountId: 'cc', date: '2026-09-30', closingBalance: 3000, movements: [] },
    ]);
  });
});

describe('relevé plus ancien que le compte, placements, opérations à venir', () => {
  // Cas de la relecture : relevé de septembre téléchargé en octobre, après une actualisation.
  const livret = account({
    id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, totalAmount: 5000, ownedAmount: 5000, balanceCheckedAt: '2026-10-20',
    movements: [{ id: 'd', date: '2026-10-15', amount: 500, label: 'Versement', type: 'IN' }],
  });
  const septembre: StatementData = {
    periodEnd: '2026-09-30',
    accounts: [{ name: 'Livret A', closingBalance: 4500, closingDate: '2026-09-30', movements: [{ date: '2026-09-12', label: 'VIR', amount: 100, type: 'IN' }], ignored: 0 }],
  };

  it('repère un solde plus ancien : dernier solde vérifié, sinon mouvement enregistré après', () => {
    expect(olderThanBalance(livret, '2026-09-30')).toEqual({ since: '2026-10-20', reason: 'checked' });
    expect(olderThanBalance(livret, '2026-10-20')).toBeNull();
    const noCheck = { movements: [
      { id: 'a', date: '2026-10-02', amount: 1, label: 'a', type: 'IN' as const },
      { id: 'b', date: '2026-10-09', amount: 1, label: 'b', type: 'OUT' as const },
      { id: 'c', date: 'illisible', amount: 1, label: 'c', type: 'IN' as const },
    ] };
    expect(olderThanBalance({ ...noCheck, balanceCheckedAt: '2026-09-01' }, '2026-09-30')).toEqual({ since: '2026-10-09', reason: 'movement' });
    expect(olderThanBalance(noCheck, '2026-10-09')).toBeNull();
    expect(olderThanBalance({ balanceCheckedAt: 'jamais' }, '2026-09-30')).toBeNull();
  });

  it("propose de ne PAS reprendre un solde plus ancien ; le reprendre reste un choix explicite", () => {
    const c = initialChoice(septembre.accounts[0], septembre, livret, '2026-10-23');
    expect(c).toMatchObject({ accountId: 'la', updateBalance: false, older: { since: '2026-10-20', reason: 'checked' } });
    expect(c.movements[0]).toMatchObject({ status: 'already-counted', selected: false });
    // Par défaut : rien à importer, le solde ne recule pas.
    expect(buildImportItems(septembre, [c], '2026-10-23')).toEqual([]);
    // Coché par l'utilisateur : la commande le reprend (allowOlder).
    const items = buildImportItems(septembre, [{ ...c, updateBalance: true }], '2026-10-23');
    expect(items).toEqual([{ accountId: 'la', date: '2026-09-30', closingBalance: 4500, allowOlder: true, movements: [] }]);
    const s0 = { accounts: [livret] };
    expect(importStatement(s0, { items: [{ ...items[0], allowOlder: undefined }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(importStatement(s0, { items }).ok).toBe(true);
  });

  it('relevé à jour : solde repris ; sans compte ou sans solde lu : rien de plus ancien', () => {
    const fresh = account({ id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, balanceCheckedAt: '2026-09-01' });
    expect(initialChoice(septembre.accounts[0], septembre, fresh, '2026-10-23')).toMatchObject({ updateBalance: true, selected: [true] });
    expect(initialChoice(septembre.accounts[0], septembre, fresh, '2026-10-23').older).toBeUndefined();
    expect(initialChoice(septembre.accounts[0], septembre, undefined, '2026-10-23')).toEqual({ updateBalance: true, selected: [], movements: [] });
    const noBalance = { ...septembre.accounts[0], closingBalance: undefined };
    const c = initialChoice(noBalance, septembre, livret, '2026-10-23');
    expect(c).toMatchObject({ updateBalance: false });
    expect(c.older).toBeUndefined();
  });

  it('placement suivi : opérations décochées par défaut, versements cumulés intacts, écart en valorisation', () => {
    const pea = account({ id: 'pea', name: 'PEA', type: AccountType.PEA, totalAmount: 10000, ownedAmount: 10000, totalDeposits: 9000, balanceCheckedAt: '2026-08-31' });
    expect(balanceOnlyByDefault(AccountType.PEA)).toBe(true);
    expect(balanceOnlyByDefault(AccountType.ASSURANCE_VIE)).toBe(true);
    expect(balanceOnlyByDefault(AccountType.COMPTE_COURANT)).toBe(true);
    expect(balanceOnlyByDefault(AccountType.LIVRET_A)).toBe(false);
    const data: StatementData = {
      periodEnd: '2026-09-30',
      accounts: [{ name: 'PEA', closingBalance: 10050, closingDate: '2026-09-30', ignored: 0, movements: [
        { date: '2026-09-10', label: 'ACHAT 10 AMUNDI MSCI WORLD', amount: 1000, type: 'OUT' },
        { date: '2026-09-20', label: 'DIVIDENDE', amount: 20, type: 'IN' },
      ] }],
    };
    const c = initialChoice(data.accounts[0], data, pea, '2026-10-23');
    expect(c.movements.map(m => [m.status, m.selected])).toEqual([['new', false], ['new', false]]);
    const r = importStatement({ accounts: [pea] }, { items: buildImportItems(data, [c], '2026-10-23') });
    if (!r.ok) throw new Error(r.error);
    const after = r.next.accounts![0];
    expect(after).toMatchObject({ totalAmount: 10050, totalDeposits: 9000 });
    expect(after.movements!.map(m => [m.label, m.amount, m.kind])).toEqual([['Valorisation (+)', 50, 'valuation']]);
  });

  it("opération datée après aujourd'hui : signalée et décochée", () => {
    const fresh = account({ id: 'la', name: 'Livret A', type: AccountType.LIVRET_A });
    const r = reviewMovements({ movements: [
      { date: '2026-10-20', label: 'VIR', amount: 10, type: 'IN' },
      { date: '2027-10-20', label: 'PRLV A VENIR', amount: 10, type: 'OUT' },
    ] }, fresh, '2026-10-23');
    expect(r.map(m => [m.status, m.selected])).toEqual([['new', true], ['future', false]]);
    // Sans date du jour (appel ancien) : pas de contrôle.
    expect(reviewMovements({ movements: [{ date: '2027-10-20', label: 'X', amount: 1, type: 'IN' }] }, fresh)[0].status).toBe('new');
  });
});
