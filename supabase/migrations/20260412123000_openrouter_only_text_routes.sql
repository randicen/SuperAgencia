-- Set all text routes to OpenRouter only, without fallback.

update public.model_routes
set
  primary_provider = 'openrouter',
  primary_model = 'google/gemma-3-12b-it',
  fallback_provider = null,
  fallback_model = null
where channel = 'text';

update public.intent_model_routes
set
  primary_provider = 'openrouter',
  primary_model = 'google/gemma-3-12b-it',
  fallback_provider = null,
  fallback_model = null
where channel = 'text';
