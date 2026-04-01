# Lessons

- Never sort user-controlled task data with `localeCompare` on required fields unless the comparator has null-safe fallbacks. Legacy or partially migrated records can crash the whole dashboard.
- When a render path depends on derived task lists, add a regression test that loads incomplete records into the store and verifies the page still renders.
- When debugging a regression, confirm the first bad commit before diffing or proposing a fix. Do not assume the current HEAD commit is the one that introduced the breakage.
- If a white screen only appears in one tab, verify the persisted UI preferences and the exact component tree for that tab before declaring the crash fixed. Shared helpers can be healthy while route-specific localStorage state is still breaking render.
- For Supabase-backed PWAs with multi-tab usage, never let every tab open its own Realtime subscriptions and fallback polling loops. Elect a single visible leader tab and let other tabs consume shared local state instead.
- When a Supabase sync issue shows high egress or Realtime peak connections but tiny database size and low user count, suspect client-side sync architecture before suspecting organic growth or storage limits.
- Do not run aggressive fallback polling when Realtime already exists. Use slower intervals and reserve polling for recovery paths, not as a second primary sync channel.
- Do not trigger cloud sync on `visibilitychange` unless there are actual unsynced local changes pending. Hidden-tab syncs can multiply background traffic without improving consistency.
- For sync architecture changes, add focused tests for coordination primitives such as leader election or lease ownership, not only data-merge tests.
