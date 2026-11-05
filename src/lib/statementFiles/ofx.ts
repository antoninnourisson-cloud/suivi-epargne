// Lecteur OFX (OFX 1.x en SGML, balises non fermées ; OFX 2.x en XML) → relevé de Pécule.
// Un seul lecteur pour toutes les banques qui proposent ce format. Fonction pure.
import { maskAccountNumbers, sanitizeStatement, type StatementData } from '../statementImport';
import { decodeText, parseDate, parseOfxAmount, StatementFileError } from './common';

interface Txn { date?: string; amount?: string; name?: string; memo?: string }
interface Stmt {
  card: boolean; currency?: string; accountId?: string; accountType?: string;
  balance?: string; balanceDate?: string; txns: Txn[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeText = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  }).replace(/\s+/g, ' ').trim();

const TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Compte courant', SAVINGS: 'Compte épargne', MONEYMRKT: 'Compte épargne', CREDITLINE: 'Ligne de crédit', CD: 'Dépôt à terme',
};

/** Relevé(s) d'un fichier OFX. Lève une StatementFileError (message en clair) si le fichier ne convient pas. */
export const parseOfx = (buf: ArrayBuffer): StatementData => {
  const text = decodeText(buf);
  const start = text.search(/<OFX[\s>]/i);
  if (start < 0) throw new StatementFileError("Ce fichier n'est pas un relevé OFX lisible.");
  const body = text.slice(start);

  const stmts: Stmt[] = [];
  let bank: string | undefined;
  let stmt: Stmt | null = null;
  let txn: Txn | null = null;
  let inBalance = false, inBank = false;
  const flushTxn = () => { if (stmt && txn) stmt.txns.push(txn); txn = null; };
  const flushStmt = () => { flushTxn(); if (stmt) stmts.push(stmt); stmt = null; };
  const tag = /<(\/?)([A-Za-z0-9_.]+)[^>]*>([^<]*)/g;
  for (let t = tag.exec(body); t; t = tag.exec(body)) {
    const closing = t[1] === '/', name = t[2].toUpperCase(), value = unescapeText(t[3]);
    if (name === 'STMTRS' || name === 'CCSTMTRS') {
      flushStmt();
      if (!closing) stmt = { card: name === 'CCSTMTRS', txns: [] };
    } else if (name === 'STMTTRN') {
      flushTxn();
      if (!closing) txn = {};
    } else if (name === 'LEDGERBAL') inBalance = !closing;
    else if (name === 'FI') inBank = !closing;
    else if (closing || !value) continue;
    else if (txn) {
      // FITID : aucun champ prévu pour le garder, ignoré.
      if (name === 'DTPOSTED') txn.date = value;
      else if (name === 'TRNAMT') txn.amount = value;
      else if (name === 'NAME') txn.name = value;
      else if (name === 'MEMO') txn.memo = value;
    } else if (stmt) {
      if (inBalance && name === 'BALAMT') stmt.balance = value;
      else if (inBalance && name === 'DTASOF') stmt.balanceDate = value;
      else if (name === 'CURDEF') stmt.currency = value.toUpperCase();
      else if (name === 'ACCTID') stmt.accountId = value;
      else if (name === 'ACCTTYPE') stmt.accountType = value.toUpperCase();
    } else if (inBank && name === 'ORG') bank = value;
  }
  flushStmt();
  if (stmts.length === 0) throw new StatementFileError('Aucun compte lisible dans ce fichier OFX.');

  const foreign = stmts.find(s => s.currency && s.currency !== 'EUR');
  if (foreign) throw new StatementFileError(`Ce relevé est en ${foreign.currency} : Pécule ne gère que les comptes en euros.`);

  const accounts = stmts.map((s, i) => {
    const masked = s.accountId ? maskAccountNumbers(s.accountId) : '';
    const kind = s.card ? 'Carte bancaire' : (s.accountType && TYPE_LABEL[s.accountType]) || '';
    const balance = s.balance !== undefined ? parseOfxAmount(s.balance) : null;
    return {
      name: [kind, masked].filter(Boolean).join(' ') || `Compte ${i + 1}`,
      numberEnd: (s.accountId ?? '').replace(/\D/g, '').slice(-4),
      closingBalance: balance ?? undefined,
      closingDate: balance !== null && s.balanceDate ? parseDate(s.balanceDate) ?? undefined : undefined,
      movements: s.txns.map(x => {
        const amount = x.amount ? parseOfxAmount(x.amount) : null;
        const label = [x.name, x.memo && x.memo !== x.name && !x.name?.includes(x.memo) ? x.memo : ''].filter(Boolean).join(' ');
        return { date: x.date ? parseDate(x.date) : null, label, amount: amount === null ? null : Math.abs(amount), direction: amount === null ? null : amount < 0 ? 'DEBIT' : 'CREDIT' };
      }),
    };
  });
  return sanitizeStatement({ bank, accounts });
};
