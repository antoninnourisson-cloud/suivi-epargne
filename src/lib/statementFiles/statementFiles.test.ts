// Lecteurs OFX et CSV : fichiers d'exemple inventés (aucune vraie donnée).
import { describe, it, expect } from 'vitest';
import { parseOfx } from './ofx';
import { buildCsvStatement, detectSeparator, guessCsv, mappingIsComplete, parseDelimited } from './csv';
import { decodeText, parseAmount, parseDate, StatementFileError } from './common';
import { readLocalStatement } from './index';

const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
/** windows-1252 : chaque caractère accentué du test tient sur un octet. */
const latin1 = (s: string) => Uint8Array.from([...s].map(c => c.charCodeAt(0) & 255)).buffer as ArrayBuffer;
const fileOf = (name: string, content: ArrayBuffer | string) => new File([content], name);

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>Banque d'exemple<FID>1</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS><STMTRS>
<CURDEF>EUR
<BANKACCTFROM><BANKID>12345<ACCTID>00012345678<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901
<DTEND>20260930
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260903120000[+2:CEST]<TRNAMT>-45,90<FITID>A1<NAME>CARTE MARCHE<MEMO>COURSES SEPTEMBRE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260915<TRNAMT>1 250.00<FITID>A2<NAME>VIR SALAIRE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260931<TRNAMT>-1.00<FITID>A3<NAME>DATE IMPOSSIBLE</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>2304.10<DTASOF>20260930</LEDGERBAL>
<AVAILBAL><BALAMT>9999<DTASOF>20260930</AVAILBAL>
</STMTRS></STMTTRNRS>
<STMTTRNRS><STMTRS>
<CURDEF>EUR
<BANKACCTFROM><ACCTID>FR7600000000009876<ACCTTYPE>SAVINGS</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260920<TRNAMT>200.00<NAME>VIR EPARGNE</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>5200.00<DTASOF>20260930</LEDGERBAL>
</STMTRS></STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</CURDEF>
<BANKACCTFROM><ACCTID>55550001234</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20261002</DTPOSTED><TRNAMT>-12.50</TRNAMT><FITID>1</FITID><NAME>Caf&#233; &amp; Cie</NAME></STMTTRN>
<STMTTRN><DTPOSTED>20261005</DTPOSTED><TRNAMT>80.00</TRNAMT><FITID>2</FITID><NAME>Remboursement</NAME><MEMO>Remboursement</MEMO></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1000.00</BALAMT><DTASOF>20261005</DTASOF></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseAmount', () => {
  it('lit les écritures françaises et anglaises', () => {
    expect(parseAmount('1 234,56')).toBe(1234.56);
    expect(parseAmount('1 234,56 €')).toBe(1234.56);
    expect(parseAmount('-12,5')).toBe(-12.5);
    expect(parseAmount('(45,00)')).toBe(-45);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('12.50')).toBe(12.5);
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('1.234.567')).toBe(1234567);
    expect(parseAmount('0,125')).toBe(0.13);
    expect(parseAmount('15,00-')).toBe(-15);
    expect(parseAmount('−8,20')).toBe(-8.2);
    expect(parseAmount('+3')).toBe(3);
  });
  it('refuse ce qui n\'est pas un montant', () => {
    for (const v of ['', 'abc', '--', '1,2,3', '12.50.1', '1.2,3.4', '€']) expect(parseAmount(v), v).toBeNull();
  });
});

describe('parseDate', () => {
  it('lit les formats courants et refuse les dates impossibles', () => {
    expect(parseDate('03/09/2026')).toBe('2026-09-03');
    expect(parseDate('3/9/26')).toBe('2026-09-03');
    expect(parseDate('2026-09-03')).toBe('2026-09-03');
    expect(parseDate('03-09-2026')).toBe('2026-09-03');
    expect(parseDate('03.09.2026 14:30')).toBe('2026-09-03');
    expect(parseDate('20260903120000[+2:CEST]')).toBe('2026-09-03');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('hier')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('decodeText', () => {
  it('UTF-8 (avec BOM) puis windows-1252', () => {
    expect(decodeText(utf8('﻿épargne'))).toBe('épargne');
    expect(decodeText(latin1('épargne à terme'))).toBe('épargne à terme');
  });
});

describe('parseOfx', () => {
  it('OFX 1.x (SGML) : deux comptes, soldes, signes, libellés, date impossible écartée', () => {
    const d = parseOfx(utf8(OFX_SGML));
    expect(d.bank).toBe("Banque d'exemple");
    expect(d.accounts).toHaveLength(2);
    const [cc, ep] = d.accounts;
    expect(cc.name).toBe('Compte courant ···5678');
    expect(cc.numberEnd).toBe('5678');
    expect(cc.closingBalance).toBe(2304.1);
    expect(cc.closingDate).toBe('2026-09-30');
    expect(cc.movements).toEqual([
      { date: '2026-09-03', label: 'CARTE MARCHE COURSES SEPTEMBRE', amount: 45.9, type: 'OUT' },
      { date: '2026-09-15', label: 'VIR SALAIRE', amount: 1250, type: 'IN' },
    ]);
    expect(cc.ignored).toBe(1);
    expect(ep.name).toBe('Compte épargne');
    expect(ep.closingBalance).toBe(5200);
    expect(ep.movements).toEqual([{ date: '2026-09-20', label: 'VIR EPARGNE', amount: 200, type: 'IN' }]);
  });

  it('OFX 2.x (XML) : entités décodées, mémo identique au nom non répété', () => {
    const d = parseOfx(utf8(OFX_XML));
    expect(d.accounts).toHaveLength(1);
    expect(d.accounts[0].movements.map(m => m.label)).toEqual(['Café & Cie', 'Remboursement']);
    expect(d.accounts[0].closingBalance).toBe(1000);
    expect(d.accounts[0].name).toBe('Compte courant ···1234');
  });

  it('refuse une devise autre que l\'euro, un fichier qui n\'est pas OFX, un OFX sans relevé', () => {
    expect(() => parseOfx(utf8(OFX_XML.replace('<CURDEF>EUR', '<CURDEF>USD')))).toThrow(/USD.*euros/);
    expect(() => parseOfx(utf8('bonjour'))).toThrow(StatementFileError);
    expect(() => parseOfx(utf8('<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>'))).toThrow(/Aucun compte/);
  });
});

const CSV_FR = [
  'Compte courant;Numéro 00012345678',
  'Période du 01/09/2026 au 30/09/2026',
  '',
  'Date opération;Date de valeur;Libellé;Débit;Crédit',
  '03/09/2026;04/09/2026;CARTE MARCHÉ;45,90;',
  '15/09/2026;15/09/2026;VIR SALAIRE;;1 250,00',
  '20/09/2026;20/09/2026;PRLV ÉLECTRICITÉ;62,10;',
  '',
].join('\r\n');

describe('CSV : détection', () => {
  it('séparateur et guillemets', () => {
    expect(detectSeparator('a;b;c\n1;2;3')).toBe(';');
    expect(detectSeparator('a,b,c\n1,2,3')).toBe(',');
    expect(detectSeparator('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectSeparator('"a;b",c,d\n"1;2",3,4')).toBe(',');
    expect(parseDelimited('a,"b,""c""",d\n1,2,3', ',')).toEqual([['a', 'b,"c"', 'd'], ['1', '2', '3']]);
  });

  it('; avec débit et crédit, lignes de banque avant l\'en-tête, windows-1252 accentué', async () => {
    const r = await readLocalStatement(fileOf('releve-septembre.csv', latin1(CSV_FR)));
    expect(r.kind).toBe('statement');
    if (r.kind !== 'statement') return;
    const a = r.data.accounts[0];
    expect(a.name).toBe('releve septembre');
    expect(a.movements).toEqual([
      { date: '2026-09-03', label: 'CARTE MARCHÉ', amount: 45.9, type: 'OUT' },
      { date: '2026-09-15', label: 'VIR SALAIRE', amount: 1250, type: 'IN' },
      { date: '2026-09-20', label: 'PRLV ÉLECTRICITÉ', amount: 62.1, type: 'OUT' },
    ]);
    // Sans colonne Solde : pas de solde, seulement les opérations.
    expect(a.closingBalance).toBeUndefined();
    expect(r.data.periodStart).toBe('2026-09-03');
    expect(r.data.periodEnd).toBe('2026-09-20');
  });

  it(', avec montant signé et date AAAA-MM-JJ', async () => {
    const csv = 'Date,Description,Montant (EUR)\n2026-10-01,"Café, croissant",-3.40\n2026-10-02,Virement reçu,"1,500.00"\n';
    const r = await readLocalStatement(fileOf('compte.csv', utf8(csv)));
    expect(r.kind).toBe('statement');
    if (r.kind === 'statement') {
      expect(r.data.accounts[0].movements).toEqual([
        { date: '2026-10-01', label: 'Café, croissant', amount: 3.4, type: 'OUT' },
        { date: '2026-10-02', label: 'Virement reçu', amount: 1500, type: 'IN' },
      ]);
    }
  });

  it('colonne Solde : solde de la ligne la plus récente, quel que soit l\'ordre du fichier', () => {
    const asc = 'Date;Libellé;Montant;Solde\n01/10/2026;A;-10,00;990,00\n02/10/2026;B;-5,00;985,00\n';
    const desc = 'Date;Libellé;Montant;Solde\n02/10/2026;B;-5,00;985,00\n01/10/2026;A;-10,00;990,00\n';
    for (const text of [asc, desc]) {
      const g = guessCsv(text);
      expect(g.ambiguous).toBe(false);
      const a = buildCsvStatement(g.table, g.mapping, 'x.csv').accounts[0];
      expect(a.closingBalance).toBe(985);
      expect(a.closingDate).toBe('2026-10-02');
    }
    // Deux lignes le même jour : la dernière du fichier si les dates montent, la première si elles descendent.
    const sameAsc = guessCsv('Date;Libellé;Montant;Solde\n02/10/2026;A;-10,00;990,00\n02/10/2026;B;-5,00;985,00\n');
    expect(buildCsvStatement(sameAsc.table, sameAsc.mapping, 'x.csv').accounts[0].closingBalance).toBe(985);
    const sameDesc = guessCsv('Date;Libellé;Montant;Solde\n02/10/2026;B;-5,00;985,00\n02/10/2026;A;-10,00;990,00\n01/10/2026;Z;-10,00;1000,00\n');
    expect(buildCsvStatement(sameDesc.table, sameDesc.mapping, 'x.csv').accounts[0].closingBalance).toBe(985);
  });

  it('détection ambiguë : pas de colonne de montant, deux colonnes Date, ou aucun nom reconnu', async () => {
    expect(guessCsv('Date;Libellé;Total\n01/10/2026;A;5,00\n').ambiguous).toBe(true);
    expect(guessCsv('Date;Date;Libellé;Montant\n01/10/2026;01/10/2026;A;5,00\n').ambiguous).toBe(true);
    const g = guessCsv('a;b;c\n01/10/2026;Loyer;-500,00\n02/10/2026;Salaire;1000,00\n');
    expect(g.ambiguous).toBe(true);
    expect(g.table.header).toEqual(['a', 'b', 'c']);
    const r = await readLocalStatement(fileOf('x.csv', utf8('Date;Libellé;Total\n01/10/2026;A;5,00\n')));
    expect(r.kind).toBe('columns');
    if (r.kind !== 'columns') return;
    // Colonnes choisies à la main.
    const m = { ...r.mapping, amount: 2 };
    expect(mappingIsComplete(m)).toBe(true);
    expect(buildCsvStatement(r.table, m, 'x.csv').accounts[0].movements).toEqual([{ date: '2026-10-01', label: 'A', amount: 5, type: 'IN' }]);
  });

  it('un débit sans signe est négatif ; un crédit reste positif ; lignes illisibles comptées', () => {
    const g = guessCsv('Date;Libellé;Débit;Crédit\n01/10/2026;A;10,00;\n02/10/2026;B;;20,00\n03/10/2026;C;;\nnon;D;1,00;\n');
    const a = buildCsvStatement(g.table, g.mapping, 'x.csv').accounts[0];
    expect(a.movements.map(m => [m.label, m.type])).toEqual([['A', 'OUT'], ['B', 'IN']]);
    expect(a.ignored).toBe(2);
  });

  it('numéros longs masqués dans les libellés', () => {
    const g = guessCsv('Date;Libellé;Montant\n01/10/2026;VIR VERS 123456789012;-10,00\n');
    expect(buildCsvStatement(g.table, g.mapping, 'x.csv').accounts[0].movements[0].label).toBe('VIR VERS ···9012');
  });

  it('fichier vide, illisible ou sans opération', async () => {
    expect(() => guessCsv('')).toThrow(/vide/);
    expect(() => guessCsv('   \n  ')).toThrow(/vide/);
    expect(() => guessCsv('un seul mot')).toThrow(/aucune colonne/);
    expect(() => guessCsv('abc\u0000\u0001def;x')).toThrow(/texte/);
    expect(() => guessCsv('Date;Libellé;Montant\n')).toThrow(/Aucune opération/);
    const g = guessCsv('Date;Libellé;Montant\nnon;A;oui\n');
    expect(() => buildCsvStatement(g.table, g.mapping, 'x.csv')).toThrow(/Aucune opération lisible/);
    expect(() => buildCsvStatement(g.table, { ...g.mapping, date: -1 }, 'x.csv')).toThrow(/Choisissez/);
    // Colonnes reconnues mais rien de lisible dedans : l'étape des colonnes plutôt qu'une erreur.
    const r = await readLocalStatement(fileOf('x.csv', utf8('Date;Libellé;Montant\nnon;A;oui\n')));
    expect(r.kind).toBe('columns');
  });
});

describe('readLocalStatement', () => {
  it('route les .ofx et .qfx vers le lecteur OFX', async () => {
    for (const name of ['a.ofx', 'b.QFX']) {
      const r = await readLocalStatement(fileOf(name, OFX_XML));
      expect(r.kind).toBe('statement');
    }
    await expect(readLocalStatement(fileOf('a.ofx', 'pas du ofx'))).rejects.toBeInstanceOf(StatementFileError);
  });
});

describe('montants ambigus et détection OFX (audit)', () => {
  const ofx = (amount: string) => `OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>00012345678<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260903<TRNAMT>${amount}<NAME>TEST</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>1.250<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("OFX : le point est toujours décimal, une virgule seule aussi", () => {
    const a = parseOfx(utf8(ofx('-45.000'))).accounts[0];
    expect(a.movements[0].amount).toBe(45);
    expect(a.closingBalance).toBe(1.25);
    expect(parseOfx(utf8(ofx('-12,5'))).accounts[0].movements[0].amount).toBe(12.5);
  });

  it('CSV : « 12.500 » est refusé et rend la détection ambiguë', () => {
    expect(parseAmount('12.500')).toBeNull();
    expect(parseAmount('-1,250')).toBeNull();
    expect(parseAmount('12.50')).toBe(12.5);
    const g = guessCsv('Date;Libellé;Montant\n01/10/2026;A;12.500\n02/10/2026;B;3,00\n');
    expect(g.ambiguous).toBe(true);
    const ok = guessCsv('Date;Libellé;Montant\n01/10/2026;A;12,50\n02/10/2026;B;3,00\n');
    expect(ok.ambiguous).toBe(false);
  });

  it("un OFX nommé « document » est reconnu à son contenu", async () => {
    const r = await readLocalStatement(fileOf('document', utf8(ofx('-4.50'))));
    expect(r.kind).toBe('statement');
  });
});
