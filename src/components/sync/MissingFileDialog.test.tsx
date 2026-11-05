// @vitest-environment jsdom
// « Votre fichier Pécule est introuvable sur Drive » : trois issues claires, « Repartir de zéro »
// seulement après confirmation, et jamais de fermeture sans choix.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MissingFileDialog } from './MissingFileDialog';
import type { MissingFileOutcome } from '../../hooks/portfolio/missingFile';

afterEach(cleanup);

const setup = (copyAt: string | null, outcome: MissingFileOutcome = 'done') => {
  const props = {
    info: { copyAt, unreadable: false },
    onRestoreDevice: vi.fn(async () => outcome),
    onStartOver: vi.fn(async () => outcome),
    onRetryFind: vi.fn(async () => true),
    listBackups: vi.fn(async () => []),
    restoreBackup: vi.fn(async () => ''),
    confirm: vi.fn(),
    onDone: vi.fn(),
  };
  render(<MissingFileDialog {...props} />);
  return props;
};

describe('MissingFileDialog', () => {
  it('propose la copie de l\'appareil avec sa date, et la restaure d\'un geste', async () => {
    const p = setup('2026-11-03T10:00:00.000Z');
    expect(screen.getByRole('dialog', { name: 'Votre fichier Pécule est introuvable sur Drive' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Restaurer la copie de cet appareil \(3 novembre/ }));
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith('done'));
    expect(p.onRestoreDevice).toHaveBeenCalledTimes(1);
    expect(p.onStartOver).not.toHaveBeenCalled();
  });

  it('sans copie lisible : pas de bouton de restauration de l\'appareil, mais les autres choix restent', () => {
    setup(null);
    expect(screen.queryByRole('button', { name: /Restaurer la copie de cet appareil/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Repartir de zéro' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chercher à nouveau/ })).toBeTruthy();
  });

  it('« Repartir de zéro » demande une confirmation avant de rien créer', async () => {
    const p = setup('2026-11-03T10:00:00.000Z');
    fireEvent.click(screen.getByRole('button', { name: 'Repartir de zéro' }));
    expect(p.onStartOver).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Non, revenir au choix' }));
    expect(p.onStartOver).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Repartir de zéro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Oui, repartir de zéro' }));
    await waitFor(() => expect(p.onStartOver).toHaveBeenCalledTimes(1));
  });

  it('échec : le message le dit, rien n\'est fermé', async () => {
    const p = setup('2026-11-03T10:00:00.000Z', 'failed');
    fireEvent.click(screen.getByRole('button', { name: /Restaurer la copie de cet appareil/ }));
    await waitFor(() => expect(screen.getByText(/n'a pas pu être créé sur Drive/)).toBeTruthy());
    expect(p.onDone).not.toHaveBeenCalled();
  });

  it('Échap ne ferme pas la fenêtre : il faut choisir', () => {
    setup('2026-11-03T10:00:00.000Z');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
