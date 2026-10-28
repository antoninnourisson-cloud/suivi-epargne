import { beforeEach, describe, expect, it, vi } from 'vitest';

const gemini = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('./geminiService', () => ({ askGeminiWithSearch: gemini.ask }));

import { askFiscalWatch, buildSourcesPrompt, FISCAL_WATCH_PROMPT } from './fiscalWatchGemini';

const page = (i: number) => ({ url: `https://www.service-public.gouv.fr/page-${i}`, topic: `Sujet ${i}`, text: `Texte ${i}` });

describe('askFiscalWatch', () => {
  beforeEach(() => { gemini.ask.mockReset(); gemini.ask.mockResolvedValue('{}'); });

  it('sans trois pages lisibles : Gemini cherche lui-même (recherche Google)', async () => {
    await expect(askFiscalWatch('cle', [page(1), page(2)])).resolves.toBe('{}');
    expect(gemini.ask).toHaveBeenCalledTimes(1);
    expect(gemini.ask).toHaveBeenCalledWith('cle', FISCAL_WATCH_PROMPT);
  });

  it('avec trois pages ou plus : relevé dans leur texte, sans recherche', async () => {
    const pages = [page(1), page(2), page(3)];
    await askFiscalWatch('cle', pages);
    expect(gemini.ask).toHaveBeenCalledWith('cle', buildSourcesPrompt(pages), 90_000, false);
    expect(gemini.ask.mock.calls[0][1]).toContain('=== PAGE 3 — Sujet 3 — https://www.service-public.gouv.fr/page-3 ===');
  });
});
