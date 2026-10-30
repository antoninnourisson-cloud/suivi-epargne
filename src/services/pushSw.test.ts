// @vitest-environment node
// Clic sur une notification (public/push-sw.js) : une fenêtre de l'app déjà ouverte reçoit
// l'écran ET l'action demandés (notification de paie : `?view=pilot&action=pay` ouvre le
// rituel « J'ai reçu ma paie », voir useDeepLinks) ; sinon une fenêtre s'ouvre sur le lien.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCOPE = 'https://app.test/';

const loadSw = (windows: { url: string; postMessage: (m: unknown) => void; focus: () => Promise<unknown> }[]) => {
  const listeners: Record<string, (e: unknown) => void> = {};
  const openWindow = vi.fn(async () => undefined);
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    registration: { scope: SCOPE, showNotification: vi.fn() },
    clients: { matchAll: async () => windows, openWindow },
  };
  new Function('self', readFileSync(resolve(__dirname, '../../public/push-sw.js'), 'utf8'))(self);
  const click = async (url: string) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({ notification: { close: () => {}, data: { url } }, waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  };
  return { click, openWindow };
};

describe('push-sw : clic sur une notification', () => {
  it('app déjà ouverte : la notification de paie transmet aussi action=pay (le rituel s’ouvre)', async () => {
    const postMessage = vi.fn();
    const { click, openWindow } = loadSw([{ url: `${SCOPE}?view=dashboard`, postMessage, focus: async () => undefined }]);
    await click(`${SCOPE}?view=pilot&action=pay`);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'open-view', view: 'pilot', action: 'pay' }));
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('sans action : rien de plus que l’écran', async () => {
    const postMessage = vi.fn();
    const { click } = loadSw([{ url: SCOPE, postMessage, focus: async () => undefined }]);
    await click(`${SCOPE}?view=pilot`);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ view: 'pilot', action: null }));
  });

  it('aucune fenêtre ouverte : l’app s’ouvre sur le lien complet', async () => {
    const { click, openWindow } = loadSw([]);
    await click(`${SCOPE}?view=pilot&action=pay`);
    expect(openWindow).toHaveBeenCalledWith(`${SCOPE}?view=pilot&action=pay`);
  });
});
