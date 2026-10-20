// @vitest-environment jsdom
// Écran de choix entre deux versions et déconnexion avec des modifications non envoyées :
// les deux versions sont montrées en clair, rien ne s'applique sans confirmation, et la
// déconnexion propose « envoyer d'abord » ou « sans envoyer ».
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { ConflictDialog } from './ConflictDialog';
import { LogoutDialog } from './LogoutDialog';
import { migrate, APP_SCHEMA_VERSION } from '../../lib/schema';
import type { SyncConflictView } from '../../hooks/usePortfolioData';

const download = vi.hoisted(() => vi.fn());
vi.mock('../../services/fileDownload', () => ({ downloadJSON: download }));

afterEach(() => { cleanup(); download.mockClear(); });

const data = (livretA: number, extra: unknown[] = []) => migrate({
  schemaVersion: APP_SCHEMA_VERSION, expenses: [], history: [],
  accounts: [
    { id: 'a', name: 'Livret A', institution: 'B', type: 'Livret A', totalAmount: livretA, ownedAmount: livretA, parentalCapital: 0, movements: extra },
    { id: 'b', name: 'LDDS', institution: 'B', type: 'LDDS', totalAmount: 1000, ownedAmount: 400, parentalCapital: 600, movements: [] },
  ],
  config: { grossAnnual: 30000, leisureBudget: 200, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
});

const view = (over: Partial<SyncConflictView> = {}): SyncConflictView => ({
  kind: 'conflict',
  local: { data: data(1500, [{ id: 'm1', date: '2026-10-12', amount: 100, type: 'IN', label: 'Épargne du mois' }]), savedAt: '2026-10-14T08:30:00.000Z', device: 'ordinateur Windows (Chrome)', fromThisDevice: true },
  remote: { data: data(1400), savedAt: '2026-10-14T07:10:00.000Z', device: 'téléphone Android (Chrome)', fromThisDevice: false },
  remoteStatus: 'ready',
  remoteFromNewerApp: false,
  ...over,
});
const nb = (s: string | null) => (s ?? '').replace(/ | /g, ' ');

describe('ConflictDialog', () => {
  it('montre les deux versions côte à côte, en clair', () => {
    render(<ConflictDialog open conflict={view()} onClose={() => {}} onResolve={async () => 'done'} onRetry={() => {}} onResolved={() => {}} />);
    const here = screen.getByRole('region', { name: 'Cet appareil' });
    const drive = screen.getByRole('region', { name: 'Drive' });
    expect(nb(here.textContent)).toContain('2 500 €');
    expect(nb(here.textContent)).toContain('1 900 €'); // votre part : 1 500 + 400
    expect(here.textContent).toContain('cet appareil (ordinateur Windows (Chrome))');
    expect(here.textContent).toContain('2 comptes, 1 mouvement');
    expect(nb(drive.textContent)).toContain('2 400 €');
    expect(drive.textContent).toContain('téléphone Android (Chrome)');
    const diffs = screen.getByRole('region', { name: 'Principales différences' });
    expect(nb(diffs.textContent)).toContain('Livret A : 1 500 € sur cet appareil, 1 400 € sur Drive');
    expect(diffs.textContent).toContain('Seulement sur cet appareil : « Épargne du mois »');
  });

  it('rien ne s’applique sans confirmation ; « Retour » annule le choix', async () => {
    const onResolve = vi.fn(async () => 'done' as const);
    const onResolved = vi.fn();
    render(<ConflictDialog open conflict={view()} onClose={() => {}} onResolve={onResolve} onRetry={() => {}} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Garder la version de Drive' }));
    expect(onResolve).not.toHaveBeenCalled();
    const step = screen.getByRole('generic', { name: 'Confirmer votre choix' });
    expect(step.textContent).toContain('Les modifications de cet appareil seront remplacées');
    expect(step.textContent).toContain('récupérable 30 jours');
    expect(document.activeElement).toBe(step);
    fireEvent.click(within(step).getByRole('button', { name: 'Retour' }));
    expect(screen.queryByRole('generic', { name: 'Confirmer votre choix' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Garder la version de cet appareil' }));
    fireEvent.click(within(screen.getByRole('generic', { name: 'Confirmer votre choix' })).getByRole('button', { name: 'Garder la version de cet appareil' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('local', 'conflict'));
    expect(onResolve).toHaveBeenCalledWith('local', { withoutCopy: false });
  });

  it('confirmation : la mise de côté est dite telle qu’elle est (effacée à la déconnexion) et la version écartée s’exporte sur place', () => {
    const v = view();
    render(<ConflictDialog open conflict={v} onClose={() => {}} onResolve={async () => 'done'} onRetry={() => {}} onResolved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Garder la version de cet appareil' }));
    const step = screen.getByRole('generic', { name: 'Confirmer votre choix' });
    expect(step.textContent).toContain('30 jours sur cet appareil, jusqu\'à votre déconnexion');
    fireEvent.click(within(step).getByRole('button', { name: "Exporter l'autre version" }));
    // Garder cette version écarte celle de Drive : c'est elle qui s'exporte.
    expect(download).toHaveBeenCalledWith(expect.stringMatching(/^pecule-drive-/), v.remote!.data);

    fireEvent.click(within(step).getByRole('button', { name: 'Retour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Garder la version de Drive' }));
    fireEvent.click(within(screen.getByRole('generic', { name: 'Confirmer votre choix' })).getByRole('button', { name: "Exporter l'autre version" }));
    expect(download).toHaveBeenLastCalledWith(expect.stringMatching(/^pecule-cet-appareil-/), v.local.data);
  });

  it('doublon : garder le fichier ouvert ne met rien de côté, rien à exporter', () => {
    render(<ConflictDialog open conflict={view({ kind: 'duplicate' })} onClose={() => {}} onResolve={async () => 'done'} onRetry={() => {}} onResolved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Garder le fichier ouvert' }));
    const step = screen.getByRole('generic', { name: 'Confirmer votre choix' });
    expect(step.textContent).not.toContain('récupérable');
    expect(within(step).queryByRole('button', { name: "Exporter l'autre version" })).toBeNull();
  });

  it('version de Drive pas encore relue : aucun choix possible, « Réessayer » si la lecture échoue', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ConflictDialog open conflict={view({ remote: null, remoteStatus: 'loading' })} onClose={() => {}} onResolve={async () => 'done'} onRetry={onRetry} onResolved={() => {}} />);
    expect((screen.getByRole('button', { name: 'Garder la version de Drive' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Garder la version de cet appareil' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ConflictDialog open conflict={view({ remote: null, remoteStatus: 'error' })} onClose={() => {}} onResolve={async () => 'done'} onRetry={onRetry} onResolved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('copie impossible : message clair, puis « Continuer sans copie » sur demande', async () => {
    const onResolve = vi.fn(async (_c: string, opts?: { withoutCopy?: boolean }) => (opts?.withoutCopy ? 'done' as const : 'copy-failed' as const));
    const onResolved = vi.fn();
    render(<ConflictDialog open conflict={view()} onClose={() => {}} onResolve={onResolve} onRetry={() => {}} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Garder la version de Drive' }));
    fireEvent.click(within(screen.getByRole('generic', { name: 'Confirmer votre choix' })).getByRole('button', { name: 'Garder la version de Drive' }));
    await screen.findByText(/Impossible de mettre l'autre version de côté/);
    expect(onResolved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer sans copie' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('remote', 'conflict'));
  });

  it("version d'une app plus récente : on ne peut que la garder", () => {
    render(<ConflictDialog open conflict={view({ remoteFromNewerApp: true })} onClose={() => {}} onResolve={async () => 'done'} onRetry={() => {}} onResolved={() => {}} />);
    expect((screen.getByRole('button', { name: 'Garder la version de cet appareil' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Garder la version de Drive' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/version plus récente de Pécule/)).toBeTruthy();
  });

  it('doublon de fichier : libellés adaptés', () => {
    render(<ConflictDialog open conflict={view({ kind: 'duplicate' })} onClose={() => {}} onResolve={async () => 'done'} onRetry={() => {}} onResolved={() => {}} />);
    expect(screen.getByRole('button', { name: 'Garder le fichier ouvert' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Prendre l'autre fichier" })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Autre fichier' })).toBeTruthy();
  });
});

describe('LogoutDialog', () => {
  it('« Envoyer puis se déconnecter » envoie, puis déconnecte sans rien effacer', async () => {
    const onSend = vi.fn(async () => true);
    const onLogout = vi.fn();
    render(<LogoutDialog open onClose={() => {}} canSend onSend={onSend} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer puis se déconnecter' }));
    await waitFor(() => expect(onLogout).toHaveBeenCalledWith(false));
    expect(onSend).toHaveBeenCalled();
  });

  it("envoi raté : on reste connecté, avec un message et le choix de partir sans envoyer", async () => {
    const onLogout = vi.fn();
    render(<LogoutDialog open onClose={() => {}} canSend onSend={async () => false} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer puis se déconnecter' }));
    await screen.findByText(/L'envoi n'a pas abouti/);
    expect(onLogout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter sans envoyer' }));
    expect(onLogout).toHaveBeenCalledWith(true);
  });

  it('envoi impossible : la raison est dite, « Annuler » ferme', () => {
    const onClose = vi.fn();
    render(<LogoutDialog open onClose={onClose} canSend={false} cannotSendReason="Vous êtes hors ligne." onSend={async () => true} onLogout={() => {}} />);
    expect((screen.getByRole('button', { name: 'Envoyer puis se déconnecter' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Vous êtes hors ligne.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onClose).toHaveBeenCalled();
  });
});
