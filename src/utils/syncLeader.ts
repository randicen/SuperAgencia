const SYNC_LEADER_KEY = 'coo_supabase_sync_leader_v1';

export interface SyncLeaderLease {
  tabId: string;
  expiresAt: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const createSyncLeaderTabId = () =>
  `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

export const readSyncLeaderLease = (): SyncLeaderLease | null => {
  try {
    const raw = localStorage.getItem(SYNC_LEADER_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return null;

    const tabId = typeof parsed.tabId === 'string' ? parsed.tabId : '';
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0;
    if (!tabId || !Number.isFinite(expiresAt)) return null;

    return { tabId, expiresAt };
  } catch {
    return null;
  }
};

export const isSyncLeaderLeaseActive = (lease: SyncLeaderLease | null, now = Date.now()) =>
  !!lease && lease.expiresAt > now;

export const writeSyncLeaderLease = (tabId: string, ttlMs: number, now = Date.now()) => {
  const lease: SyncLeaderLease = {
    tabId,
    expiresAt: now + ttlMs,
  };

  localStorage.setItem(SYNC_LEADER_KEY, JSON.stringify(lease));
  return lease;
};

export const claimSyncLeaderLease = (tabId: string, ttlMs: number, now = Date.now()) => {
  const currentLease = readSyncLeaderLease();
  if (!isSyncLeaderLeaseActive(currentLease, now) || currentLease?.tabId === tabId) {
    return writeSyncLeaderLease(tabId, ttlMs, now);
  }

  return currentLease;
};

export const releaseSyncLeaderLease = (tabId: string) => {
  const currentLease = readSyncLeaderLease();
  if (currentLease?.tabId === tabId) {
    localStorage.removeItem(SYNC_LEADER_KEY);
  }
};

export const getSyncLeaderStorageKey = () => SYNC_LEADER_KEY;
