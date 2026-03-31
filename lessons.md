# Lessons

- Never sort user-controlled task data with `localeCompare` on required fields unless the comparator has null-safe fallbacks. Legacy or partially migrated records can crash the whole dashboard.
- When a render path depends on derived task lists, add a regression test that loads incomplete records into the store and verifies the page still renders.
- When debugging a regression, confirm the first bad commit before diffing or proposing a fix. Do not assume the current HEAD commit is the one that introduced the breakage.
- If a white screen only appears in one tab, verify the persisted UI preferences and the exact component tree for that tab before declaring the crash fixed. Shared helpers can be healthy while route-specific localStorage state is still breaking render.
