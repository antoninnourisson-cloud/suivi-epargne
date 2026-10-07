// Test « par propriétés » : des milliers de séquences aléatoires (mais reproductibles,
// générateur à graine) d'opérations et d'annulations. Après chaque pas, pour chaque compte :
// total = part propre + part des parents au centime, part des parents jamais négative, et
// une annulation dans l'ordre inverse rend l'état d'avant à l'identique.
import { describe, it, expect } from 'vitest';
import { AccountType, SavingsAccount } from '../../types';
import { round2 } from '../accountOps';
import {
  applyPatch, CommandOk, CommandResult, CommandState,
  quickAdd, deleteMovement, cancelDeposit, saveAccount, deleteAccount, recordRestitution, undoRestitution,
} from './index';

/** mulberry32 : petit générateur pseudo-aléatoire à graine, sans dépendance. */
const prng = (seed: number) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const initial = (): CommandState => ({
  accounts: [
    { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000, interestRate: 2.4, movements: [] },
    { id: 'lep', name: 'LEP', institution: 'B', type: AccountType.LEP, totalAmount: 10000.37, ownedAmount: 7500.25, parentalCapital: 2500.12, interestRate: 3.5, movements: [] },
    { id: 'av', name: 'AV', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0, totalDeposits: 4000, movements: [] },
    { id: 'cc', name: 'CC', institution: 'B', type: AccountType.COMPTE_COURANT, totalAmount: 0.1, ownedAmount: 0.1, parentalCapital: 0, movements: [] },
  ],
  parentalRestitution: { plannedDate: '2027-01-01' },
});

const checkInvariants = (s: CommandState, where: string) => {
  for (const a of s.accounts) {
    const fine = a.parentalCapital >= 0
      && round2(a.ownedAmount) === a.ownedAmount
      && round2(a.parentalCapital) === a.parentalCapital
      && a.totalAmount === round2(a.ownedAmount + a.parentalCapital);
    if (!fine) expect.fail(`${where} — ${a.id} ${JSON.stringify({ o: a.ownedAmount, p: a.parentalCapital, t: a.totalAmount })}`);
  }
};

type Entry = { name: string; result: CommandOk; before: CommandState; exact: boolean };

const runSequence = (seed: number, steps: number) => {
  const rnd = prng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const cents = (max: number) => Math.round(rnd() * max * 100) / 100;
  let s = initial();
  const stack: Entry[] = [];
  let id = 0;

  for (let step = 0; step < steps; step++) {
    const where = `graine ${seed}, pas ${step}`;
    const frozen = JSON.stringify(s);
    const accounts = s.accounts;
    const roll = rnd();
    let name: string;
    let r: CommandResult;

    if (stack.length > 0 && roll < 0.2) {
      // Annulation : le plus souvent la dernière opération (exacte), parfois une plus ancienne.
      const lifo = rnd() < 0.8;
      const idx = lifo ? stack.length - 1 : Math.floor(rnd() * stack.length);
      const [entry] = stack.splice(idx, 1);
      s = applyPatch(s, entry.result.undo(s));
      if (idx === stack.length && entry.exact) expect(s, `${where} : annulation de ${entry.name}`).toEqual(entry.before);
      else stack.forEach(e => { e.exact = false; });
      checkInvariants(s, where);
      continue;
    }

    if (accounts.length === 0 || roll < 0.45) {
      const acc = accounts.length > 0 && rnd() < 0.9 ? pick(accounts) : undefined;
      const type = rnd() < 0.5 ? 'IN' : 'OUT';
      const amount = cents(type === 'OUT' ? 12000 : 3000);
      name = `quickAdd ${type} ${amount} ${acc?.id}`;
      r = quickAdd(s, { accountId: acc?.id ?? 'disparu', amount, type, label: 'x', date: '2026-10-01', id: `m${id++}` });
      if (acc && amount > 0) {
        // Refus si et seulement si le retrait entamerait la part des parents.
        expect(r.ok, `${where} ${name} (part propre ${acc.ownedAmount})`).toBe(type === 'IN' || amount <= acc.ownedAmount + 0.005);
      }
      if (r.ok && acc) {
        const after = applyPatch(s, r.next).accounts.find(a => a.id === acc.id)!;
        expect(after.parentalCapital, where).toBe(acc.parentalCapital);
      }
    } else if (roll < 0.6) {
      const withMoves = accounts.filter(a => (a.movements || []).length > 0);
      if (withMoves.length === 0) continue;
      const acc = pick(withMoves);
      const m = pick(acc.movements!);
      const useCancel = rnd() < 0.3;
      name = `${useCancel ? 'cancelDeposit' : 'deleteMovement'} ${m.id}`;
      r = useCancel ? cancelDeposit(s, { accountId: acc.id, movementId: m.id }) : deleteMovement(s, { accountId: acc.id, movementId: m.id });
      if (m.tag === 'restitution') expect(r.ok, where).toBe(false);
    } else if (roll < 0.72) {
      const acc = pick(accounts);
      const isNew = rnd() < 0.2;
      const edited: SavingsAccount = isNew
        ? { id: `n${id++}`, name: 'Nouveau', institution: 'X', type: AccountType.LDDS, totalAmount: 0, ownedAmount: rnd() * 2000, parentalCapital: 0 }
        : { ...acc, ownedAmount: rnd() * 10000, parentalCapital: rnd() < 0.5 ? acc.parentalCapital : rnd() * 5000, totalAmount: -1 };
      name = `saveAccount ${edited.id}`;
      r = saveAccount(s, { account: edited, today: '2026-10-07' });
    } else if (roll < 0.78) {
      name = 'deleteAccount';
      r = deleteAccount(s, { accountId: pick(accounts).id });
    } else if (roll < 0.9) {
      name = 'recordRestitution';
      const wasDone = !!s.parentalRestitution?.done;
      r = recordRestitution(s, { date: pick(['2026-12-16', '2027-01-01', '2027-01-04']) });
      if (wasDone) expect(r.ok, where).toBe(false);
      if (r.ok) {
        const after = applyPatch(s, r.next);
        for (const a of after.accounts) {
          expect(a.parentalCapital, where).toBe(0);
          expect(a.ownedAmount, where).toBe(accounts.find(x => x.id === a.id)!.ownedAmount);
        }
        const restituted = after.parentalRestitution!.done!.accounts.reduce((t, x) => t + x.amount, 0);
        expect(round2(restituted), where).toBe(round2(accounts.reduce((t, a) => t + a.parentalCapital, 0)));
      }
    } else {
      name = 'undoRestitution';
      r = undoRestitution(s);
    }

    // Une commande ne modifie jamais l'état qu'on lui passe.
    if (JSON.stringify(s) !== frozen) expect.fail(`${where} ${name} a modifié son entrée`);
    if (r.ok) {
      const before = s;
      s = applyPatch(s, r.next);
      stack.push({ name, result: r, before, exact: true });
    }
    checkInvariants(s, `${where} après ${name}`);
  }

  // Tout annuler dans l'ordre inverse : retour à l'état de départ si rien n'a été annulé dans le désordre.
  const allExact = stack.every(e => e.exact);
  const start = stack[0]?.before;
  while (stack.length > 0) {
    const entry = stack.pop()!;
    s = applyPatch(s, entry.result.undo(s));
    checkInvariants(s, `graine ${seed}, annulation finale de ${entry.name}`);
  }
  if (allExact && start) expect(s, `graine ${seed} : annulation complète`).toEqual(start);
};

describe('invariants des commandes (séquences aléatoires)', () => {
  it('total = part propre + part des parents au centime, part des parents jamais négative, annulations exactes', () => {
    for (let seed = 1; seed <= 200; seed++) runSequence(seed, 50);
  }, 30_000);
});
