import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSpacesSyncExecutionMode, shouldLockSpacesWrites } from './spacesSyncMode.ts';

test('bootstrap is always pull-only', () => {
  assert.equal(resolveSpacesSyncExecutionMode({
    reason: 'bootstrap',
    hasHydratedSpacesThisSession: true,
    spacesWritesLocked: false,
    hasPendingPwaRefresh: false,
  }), 'pull');
});

test('local-change stays pull-only before first hydration', () => {
  assert.equal(resolveSpacesSyncExecutionMode({
    reason: 'local-change',
    hasHydratedSpacesThisSession: false,
    spacesWritesLocked: true,
    hasPendingPwaRefresh: false,
  }), 'pull');
});

test('local-change stays pull-only while refresh is pending', () => {
  assert.equal(resolveSpacesSyncExecutionMode({
    reason: 'local-change',
    hasHydratedSpacesThisSession: true,
    spacesWritesLocked: true,
    hasPendingPwaRefresh: true,
  }), 'pull');
});

test('manual/local-change can push only after hydration and without lock', () => {
  assert.equal(resolveSpacesSyncExecutionMode({
    reason: 'manual',
    hasHydratedSpacesThisSession: true,
    spacesWritesLocked: false,
    hasPendingPwaRefresh: false,
  }), 'push');
});

test('write lock follows hydration and pending refresh', () => {
  assert.equal(shouldLockSpacesWrites({
    hasHydratedSpacesThisSession: false,
    hasPendingPwaRefresh: false,
  }), true);

  assert.equal(shouldLockSpacesWrites({
    hasHydratedSpacesThisSession: true,
    hasPendingPwaRefresh: true,
  }), true);

  assert.equal(shouldLockSpacesWrites({
    hasHydratedSpacesThisSession: true,
    hasPendingPwaRefresh: false,
  }), false);
});
