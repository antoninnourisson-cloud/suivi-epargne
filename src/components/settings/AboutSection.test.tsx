// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AboutSection } from './AboutSection';

afterEach(cleanup);

describe('AboutSection : liens utiles', () => {
  it('propose la confidentialité et les mentions légales', () => {
    render(<AboutSection />);
    expect(screen.getByRole('link', { name: 'Confidentialité' }).getAttribute('href')).toBe('confidentialite.html');
    expect(screen.getByRole('link', { name: 'Mentions légales' }).getAttribute('href')).toBe('mentions-legales.html');
  });
});
