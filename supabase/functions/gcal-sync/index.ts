import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface GoogleEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from JWT
    const { data: { user }, error: authError } = await createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }
    }).auth.getUser();

    if (authError || !user) throw new Error("Unauthorized");

    const userId = user.id;

    // 1. Get the provider_token (Google Access Token) from Supabase Auth
    // Note: This requires 'Google' provider to be enabled and user to be linked.
    const { data: identities, error: identityError } = await supabase.auth.admin.listUserIdentities(userId);
    
    if (identityError) throw identityError;
    
    const googleIdentity = identities.find(i => i.provider === 'google');
    if (!googleIdentity) {
      return new Response(JSON.stringify({ error: "No Google account connected" }), {
        status: 200, // Return 200 so the frontend handles it gracefully
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Attempt to get the provider token. 
    // In Supabase, if the user just logged in, the token is in the session.
    // For background sync, we'd normally need a refresh_token flow.
    // For now, we expect the frontend to provide the token or use the current active one.
    
    // FETCH GOOGLE CALENDAR EVENTS
    // Access token is often available in the auth.identities or via a specific table if you store it.
    // For this implementation, we assume Supabase is managing the Google session.
    
    // IMPORTANT: To call Google API, we need the access_token. 
    // Usually, the easiest way in an Edge Function is to receive it from the client 
    // OR have a table where we store the refresh_token.
    
    // For MVP, let's try to get it from the user's current session or identity metadata.
    const accessToken = googleIdentity.identity_data.provider_token || googleIdentity.identity_data.access_token;

    if (!accessToken) {
       // If no token in identity, we need the user to re-authenticate or we provide a fallback message
       return new Response(JSON.stringify({ error: "No access token found. Please re-connect Google." }), {
         status: 200,
         headers: { ...corsHeaders, "Content-Type": "application/json" },
       });
    }

    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const gcalUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;

    console.log(`[gcal-sync] Fetching from Google API for ${user.email}...`);
    const gcalRes = await fetch(gcalUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!gcalRes.ok) {
        const errText = await gcalRes.text();
        console.error(`[gcal-sync] Google API Error:`, errText);
        // If 401, token expired
        if (gcalRes.status === 401) {
            return new Response(JSON.stringify({ error: "Google session expired. Please reconnect." }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        throw new Error(`Google API returned ${gcalRes.status}`);
    }

    const gcalData = await gcalRes.json();
    const googleEvents: GoogleEvent[] = gcalData.items || [];

    // Map to SpaceEvents
    const events = googleEvents.map(ge => {
      const start = ge.start.dateTime || ge.start.date || "";
      const end = ge.end.dateTime || ge.end.date || "";
      
      // Convert to local ISO format (remove Z or offset if needed, but our app prefers ISO)
      return {
        id: `gcal-${ge.id}`,
        nombre: ge.summary || "Evento Google",
        startDate: start.substring(0, 16), // Format: YYYY-MM-DDTHH:mm
        endDate: end.substring(0, 16),
        description: ge.description
      };
    });

    // Cache the result
    const nowIso = new Date().toISOString();
    await supabase.from("gcal_cache").upsert({
      user_id: userId,
      events_json: events,
      fetched_at: nowIso,
    });

    return new Response(JSON.stringify({
      events,
      cachedAt: nowIso,
      fromCache: false,
      count: events.length
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[gcal-sync] Fatal Error:", err);
    return new Response(JSON.stringify({ error: err.message, events: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
