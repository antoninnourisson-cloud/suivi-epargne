import { describe, it, expect, vi, afterEach } from 'vitest';
import { askPecule, buildAskSystemPrompt, cleanAnswer, describeAskError, askDateLabel, ASK_QUESTION_MAX } from './askPecule';
import { GeminiError } from './geminiService';

const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'réflexion', thought: true }, { text }] } }] }), { status: 200 });

afterEach(() => { vi.unstubAllGlobals(); });

describe('askPecule', () => {
  it('envoie la consigne, le résumé et la conversation, sans outil, clé dans l\'en-tête', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => reply('Vous avez épargné **600 €**.'));
    vi.stubGlobal('fetch', fetchMock);
    const history = [{ role: 'model' as const, text: 'orpheline' }, { role: 'user' as const, text: 'Bonjour' }, { role: 'model' as const, text: 'Bonjour !' }];
    const answer = await askPecule('cle', { json: '{"totaux":{"solde":1}}', asOf: '2026-10-28' }, history, `  ${'x'.repeat(ASK_QUESTION_MAX + 50)}  `, { retryDelaysMs: [] });
    expect(answer).toBe('Vous avez épargné 600 €.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(':generateContent');
    expect(url).not.toContain('cle');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('cle');
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{ code_execution: {} }]);
    expect(body.system_instruction.parts[0].text).toContain('{"totaux":{"solde":1}}');
    expect(body.system_instruction.parts[0].text).toContain('28 octobre 2026');
    // La conversation commence par une question ; la dernière question est raccourcie.
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[2].parts[0].text).toHaveLength(ASK_QUESTION_MAX);
  });

  it('garde le texte de la réponse sans le code exécuté, et réinterroge sans outil si le modèle le refuse', async () => {
    const withCode = new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { executableCode: { language: 'PYTHON', code: 'print(1+2)' } }, { codeExecutionResult: { outcome: 'OUTCOME_OK', output: '3' } }, { text: 'Total : 3 €.' },
    ] } }] }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => withCode));
    expect(await askPecule('cle', { json: '{}', asOf: '2026-10-28' }, [], 'Total ?', { retryDelaysMs: [] })).toBe('Total : 3 €.');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('code execution is not supported', { status: 400 }))
      .mockResolvedValueOnce(reply('Sans outil.'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await askPecule('cle', { json: '{}', asOf: '2026-10-28' }, [], 'Total ?', { retryDelaysMs: [] })).toBe('Sans outil.');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).tools).toBeUndefined();
  });

  it('lève une GeminiError AUTH quand la clé est refusée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const err = await askPecule('cle', { json: '{}', asOf: '2026-10-28' }, [], 'Question', { retryDelaysMs: [] }).catch(e => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(describeAskError(err)).toMatch(/refuse la clé/);
  });
});

describe('aides de « Demander à Pécule »', () => {
  it('traduit les erreurs en français', () => {
    expect(describeAskError(new GeminiError('x', 'OVERLOADED'))).toMatch(/très sollicité/);
    expect(describeAskError(new GeminiError('RÉPONSE_GEMINI_VIDE'))).toMatch(/n'a pas pu répondre/);
    expect(describeAskError(new TypeError('Failed to fetch'))).toMatch(/connexion/);
  });

  it('nettoie la mise en forme et raccourcit une réponse trop longue', () => {
    expect(cleanAnswer('## Titre\n* un\n• deux\n**gras**')).toBe('Titre\n- un\n- deux\ngras');
    expect(cleanAnswer('a'.repeat(7000))).toHaveLength(6001);
  });

  it('donne la consigne en français, avec la date du résumé', () => {
    expect(askDateLabel('2026-01-05')).toBe('5 janvier 2026');
    const prompt = buildAskSystemPrompt('{}', '2026-01-05');
    expect(prompt).toMatch(/N'invente jamais de chiffre/);
    expect(prompt).toMatch(/ne permettent pas de répondre/);
    expect(prompt).toMatch(/Tu ne peux rien modifier/);
  });
});
