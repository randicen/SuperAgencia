-- Revert unapproved model routing changes
-- Baseline: git HEAD (commit 3dabefb)
-- This restores conversation and planner_read to openrouter as primary, google as fallback.

-- Revert model_routes (non-intent-based fallback)
update public.model_routes
set
  primary_provider = 'openrouter',
  primary_model = 'google/gemma-3-12b-it:free',
  fallback_provider = 'google',
  fallback_model = 'gemini-3.1-flash-lite-preview'
where channel = 'text'
  and plan_code in ('free', 'premium');

-- Revert intent_model_routes: conversation and planner_read
-- Restore openrouter as primary, google as fallback
update public.intent_model_routes
set
  primary_provider = 'openrouter',
  primary_model = 'google/gemma-3-12b-it:free',
  fallback_provider = 'google',
  fallback_model = 'gemini-3.1-flash-lite-preview',
  model_tier = 'fast'
where intent_route in ('conversation', 'planner_read')
  and channel = 'text'
  and plan_code in ('free', 'premium');

-- planner_mutation, external_lookup, hybrid remain unchanged:
--   primary: google/gemini-3.1-flash-lite-preview
--   fallback: openrouter/google/gemma-3-12b-it:free
