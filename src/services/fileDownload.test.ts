// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, downloadJSON } from './fileDownload';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const capture = () => {
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:test'; });
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const clicks: { name: string; attached: boolean }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ name: this.download, attached: document.body.contains(this) });
  });
  return { blobs, clicks, revokeObjectURL };
};

describe('téléchargement d’un fichier créé dans le navigateur', () => {
  it('downloads a CSV for French Excel, then frees the temporary link', async () => {
    vi.useFakeTimers();
    const { blobs, clicks, revokeObjectURL } = capture();
    downloadCsv('dons-2026.csv', [['Association', 'Montant (€)'], ['Les Restos; Paris', '50,00']]);
    expect(clicks).toEqual([{ name: 'dons-2026.csv', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
    expect(new TextDecoder().decode(bytes)).toContain('"Les Restos; Paris";50,00');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('downloads indented JSON', async () => {
    const { blobs, clicks } = capture();
    downloadJSON('pecule.json', { a: 1 });
    expect(clicks[0].name).toBe('pecule.json');
    expect(await blobs[0].text()).toBe('{\n  "a": 1\n}');
  });
});
