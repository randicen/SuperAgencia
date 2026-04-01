import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimSyncLeaderLease,
  getSyncLeaderStorageKey,
  isSyncLeaderLeaseActive,
  readSyncLeaderLease,
  releaseSyncLeaderLease,
} from './syncLeader.ts';

const createMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

Object.defineProperty(globalThis, 'localStorage', {
  value: createMemoryStorage(),
  configurable: true,
});

test('claims a free lease for the requesting tab', () => {
  localStorage.clear();

  const lease = claimSyncLeaderLease('tab-a', 30000, 1000);

  assert.equal(lease.tabId, 'tab-a');
  assert.equal(lease.expiresAt, 31000);
  assert.deepEqual(readSyncLeaderLease(), lease);
  assert.equal(isSyncLeaderLeaseActive(lease, 2000), true);
});

test('keeps the active leader when another tab tries to claim', () => {
  localStorage.clear();

  claimSyncLeaderLease('tab-a', 30000, 1000);
  const competingLease = claimSyncLeaderLease('tab-b', 30000, 2000);

  assert.equal(competingLease.tabId, 'tab-a');
  assert.equal(readSyncLeaderLease()?.tabId, 'tab-a');
});

test('releases the lease only for the current leader', () => {
  localStorage.clear();

  claimSyncLeaderLease('tab-a', 30000, 1000);
  releaseSyncLeaderLease('tab-b');

  assert.notEqual(localStorage.getItem(getSyncLeaderStorageKey()), null);

  releaseSyncLeaderLease('tab-a');

  assert.equal(localStorage.getItem(getSyncLeaderStorageKey()), null);
});
