// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  describeStatementError, isDemoSession, readStatementFile, StatementReadError, statementMimeType, STATEMENT_MAX_BYTES,
} from './statementReader';
import { GeminiError } from './geminiService';

const pdf = (content = '%PDF-1.4 relevé', name = 'releve.pdf', type = 'application/pdf') => new File([content], name, { type });
const NO_WAIT = { retryDelaysMs: [0, 0], demo: false };
const geminiOk = (fields: object) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }] }), { status: 200 });
const errorOf = (p: Promise<unknown>) => p.then(() => { throw new Error('aurait dû échouer'); }, (e: unknown) => e as StatementReadError);

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('statementMimeType', () => {
  it('accepte un PDF ou une image, même sans type annoncé pour un .pdf', () => {
    expect(statementMimeType({ type: 'application/pdf', name: 'a' })).toBe('application/pdf');
    expect(statementMimeType({ type: 'image/png', name: 'a.png' })).toBe('image/png');
    expect(statementMimeType({ type: '', name: 'Relevé.PDF' })).toBe('application/pdf');
    expect(statementMimeType({ type: '', name: 'releve.csv' })).toBeNull();
    expect(statementMimeType({ type: 'text/csv', name: 'releve.csv' })).toBeNull();
  });
});

describe('readStatementFile', () => {
  it('refuse un fichier qui ne convient pas, sans rien envoyer', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect((await errorOf(readStatementFile(pdf('a,b', 'releve.csv', 'text/csv'), 'k', NO_WAIT))).kind).toBe('file');
    const big = pdf();
    Object.defineProperty(big, 'size', { value: STATEMENT_MAX_BYTES + 1 });
    expect((await errorOf(readStatementFile(big, 'k', NO_WAIT))).message).toContain('15 Mo');
    expect((await errorOf(readStatementFile(pdf(''), 'k', NO_WAIT))).message).toBe('Ce fichier est vide.');
    expect((await errorOf(readStatementFile(pdf(), '', NO_WAIT))).kind).toBe('key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('envoie le document à Gemini et renvoie le relevé filtré', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return geminiOk({ bank: 'B', accounts: [{ name: 'Livret A', closingBalance: 10, movements: [] }] });
    }));
    const r = await readStatementFile(pdf(), 'k', NO_WAIT);
    expect(r.accounts[0]).toMatchObject({ name: 'Livret A', closingBalance: 10 });
    const sent = JSON.parse(bodies[0]).contents[0].parts[1].inline_data;
    expect(sent.mime_type).toBe('application/pdf');
    expect(atob(sent.data)).toContain('%PDF-1.4');
  });

  it('traduit les erreurs de Gemini en messages clairs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    expect((await errorOf(readStatementFile(pdf(), 'k', NO_WAIT))).kind).toBe('key');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const offline = await errorOf(readStatementFile(pdf(), 'k', NO_WAIT));
    expect(offline.kind).toBe('failed');
    expect(offline.message).toContain('connexion');
    expect(describeStatementError(new GeminiError('x', 'OVERLOADED')).kind).toBe('busy');
    expect(describeStatementError(new GeminiError('RÉPONSE_GEMINI_ILLISIBLE')).message).toContain('PDF d\'origine');
    const same = new StatementReadError('m', 'file');
    expect(describeStatementError(same)).toBe(same);
  });

  it('mode démo : lecture fictive, sans clé ni envoi', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(isDemoSession()).toBe(false);
    window.history.replaceState(null, '', '/?demo=1');
    expect(isDemoSession()).toBe(true);
    const r = await readStatementFile(pdf(), '');
    expect(r.bank).toBe('Banque Démo');
    expect(r.accounts.map(a => a.name)).toEqual(['Livret A ···1234', 'Compte de dépôt ···5678', 'Livret Jeune ···9012']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
