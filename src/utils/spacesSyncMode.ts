import type { SpacesSyncCycleReason } from './spacesSyncReconciliation';

export type SpacesSyncExecutionMode = 'pull' | 'push';

interface ResolveSpacesSyncModeOptions {
  reason: SpacesSyncCycleReason;
  hasHydratedSpacesThisSession: boolean;
  spacesWritesLocked: boolean;
  hasPendingPwaRefresh: boolean;
}

const PULL_ONLY_REASONS = new Set<SpacesSyncCycleReason>(['bootstrap', 'remote-change', 'online']);

export const resolveSpacesSyncExecutionMode = ({
  reason,
  hasHydratedSpacesThisSession,
  spacesWritesLocked,
  hasPendingPwaRefresh,
}: ResolveSpacesSyncModeOptions): SpacesSyncExecutionMode => {
  if (PULL_ONLY_REASONS.has(reason)) return 'pull';
  if (!hasHydratedSpacesThisSession) return 'pull';
  if (spacesWritesLocked) return 'pull';
  if (hasPendingPwaRefresh) return 'pull';
  return 'push';
};

export const shouldLockSpacesWrites = ({
  hasHydratedSpacesThisSession,
  hasPendingPwaRefresh,
}: Pick<ResolveSpacesSyncModeOptions, 'hasHydratedSpacesThisSession' | 'hasPendingPwaRefresh'>) =>
  !hasHydratedSpacesThisSession || hasPendingPwaRefresh;
