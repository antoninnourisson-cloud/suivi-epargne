// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LoginScreen } from './LoginScreen';

afterEach(cleanup);

describe('LoginScreen : liens du bas', () => {
  it('propose la présentation, la confidentialité et les mentions légales', () => {
    render(<LoginScreen ready apiError={false} lockResetPending={false} onCancelLockReset={vi.fn()} onLogin={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Confidentialité' }).getAttribute('href')).toBe('confidentialite.html');
    expect(screen.getByRole('link', { name: 'Mentions légales' }).getAttribute('href')).toBe('mentions-legales.html');
    expect(screen.getByRole('link', { name: 'Découvrir Pécule' }).getAttribute('href')).toBe('presentation.html');
  });
});
