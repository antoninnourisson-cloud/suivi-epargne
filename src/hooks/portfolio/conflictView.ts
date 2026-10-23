// Ce que l'écran de choix entre deux versions affiche (fonction pure) et l'identité de cet
// appareil (signature de chaque écriture : date, appareil en clair, identifiant aléatoire).
import { useCallback, useMemo, useRef } from 'react';
import { lsGet, lsSet } from '../../lib/storage';
import { migrate, isFromNewerApp } from '../../lib/schema';
import { readWriteStamp, describeDevice, stampDevice, stampIsFromDevice, type WriteStamp } from '../../lib/writeStamp';
import type { GlobalAppData } from '../../types';
import { DEVICE_ID_KEY } from './keys';
import type { ConflictCtx, ConflictVersion, SyncConflictView } from './syncShared';

/**
 * La version de cet appareil est toujours l'état affiché (`localData`). Pour un doublon, la
 * version « locale » est le fichier ouvert : son appareil vient de sa signature (`headStamp`).
 */
export const buildConflictView = (
  ctx: ConflictCtx, localData: GlobalAppData, headStamp: WriteStamp | null, thisDevice: string, deviceId: string,
): SyncConflictView => {
  const duplicate = ctx.kind === 'duplicate';
  const local: ConflictVersion = duplicate
    ? { data: localData, savedAt: ctx.localSavedAt, device: stampDevice(headStamp, ctx.localSavedAt), fromThisDevice: false }
    : { data: localData, savedAt: ctx.localSavedAt, device: thisDevice, fromThisDevice: true };
  let remote: ConflictVersion | null = null;
  if (ctx.remoteStatus === 'ready') {
    const stamp = readWriteStamp(ctx.remoteRaw);
    remote = {
      data: migrate(ctx.remoteRaw),
      savedAt: ctx.remoteSavedAt ?? stamp?.at ?? null,
      device: stampDevice(stamp, ctx.remoteSavedAt),
      fromThisDevice: stampIsFromDevice(stamp, deviceId, ctx.remoteSavedAt),
    };
  }
  return {
    kind: ctx.kind, local, remote, remoteStatus: ctx.remoteStatus,
    remoteFromNewerApp: ctx.remoteStatus === 'ready' && isFromNewerApp(ctx.remoteRaw),
  };
};

/** Cet appareil : description en clair, identifiant aléatoire (créé au premier besoin), signature d'écriture. */
export const useDeviceIdentity = () => {
  const thisDevice = useMemo(() => describeDevice(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);
  const deviceIdRef = useRef('');
  const deviceId = useCallback(() => {
    if (!deviceIdRef.current) {
      let id = lsGet(DEVICE_ID_KEY);
      if (!id) { id = crypto.randomUUID(); lsSet(DEVICE_ID_KEY, id); }
      deviceIdRef.current = id;
    }
    return deviceIdRef.current;
  }, []);
  const makeStamp = useCallback((): WriteStamp => ({ at: new Date().toISOString(), device: thisDevice, deviceId: deviceId() }), [thisDevice, deviceId]);
  return { thisDevice, deviceId, makeStamp };
};
