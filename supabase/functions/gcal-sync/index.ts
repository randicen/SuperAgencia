// Supabase Edge Function: Google Calendar Sensor
// Fetches user's iCal feed server-side, parses with ical.js, caches in DB.
// No CORS issues, no third-party proxies, RFC 5545 compliant.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import ICAL from "https://esm.sh/ical.js@2.1.0";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const EVENT_WINDOW_DAYS = 14; // Only import next 14 days

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ParsedEvent {
  id: string;
  nombre: string;
  startDate: string;
  endDate: string;
  description?: string;
}

const toLocalISO = (jcalTime: typeof ICAL.Time): string => {
  if (!jcalTime) return "";
  const jsDate = jcalTime.toJSDate();
  const y = jsDate.getFullYear();
  const m = String(jsDate.getMonth() + 1).padStart(2, "0");
  const d = String(jsDate.getDate()).padStart(2, "0");
  const h = String(jsDate.getHours()).padStart(2, "0");
  const min = String(jsDate.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
};

const parseICalFeed = (icalData: string): ParsedEvent[] => {
  const jcalData = ICAL.parse(icalData);
  const comp = new ICAL.Component(jcalData);
  const vevents = comp.getAllSubcomponents("vevent");

  const now = new Date();
  const limit = new Date();
  limit.setDate(now.getDate() + EVENT_WINDOW_DAYS);

  const events: ParsedEvent[] = [];

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    const summary = event.summary || "Evento GCal";
    const dtStart = event.startDate;
    const dtEnd = event.endDate;

    if (!dtStart || !dtEnd) continue;

    // Handle recurring events (expand occurrences within window)
    if (event.isRecurring()) {
      const iterator = event.iterator();
      let next = iterator.next();
      let safety = 0;

      while (next && safety < 200) {
        safety++;
        const occurrenceStart = next.toJSDate();

        if (occurrenceStart > limit) break;

        if (occurrenceStart >= now) {
          const durationMs = dtEnd.toJSDate().getTime() - dtStart.toJSDate().getTime();
          const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);

          events.push({
            id: `gcal-${event.uid}-${occurrenceStart.getTime()}`,
            nombre: summary,
            startDate: toLocalISO(next),
            endDate: toLocalISO(ICAL.Time.fromJSDate(occurrenceEnd, false)),
            description: event.description || undefined,
          });
        }

        next = iterator.next();
      }
    } else {
      // Single event
      const startJs = dtStart.toJSDate();
      if (startJs >= now && startJs <= limit) {
        events.push({
          id: `gcal-${event.uid}`,
          nombre: summary,
          startDate: toLocalISO(dtStart),
          endDate: toLocalISO(dtEnd),
          description: event.description || undefined,
        });
      }
    }
  }

  // Sort by start date
  events.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  return events;
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Auth: Extract user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Client with user's JWT (for RLS-protected reads)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service client (for cache writes, bypasses RLS)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get authenticated user
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // 2. Handle URL save (POST with icalUrl)
    let body: { action?: string; icalUrl?: string } = {};
    if (req.method === "POST") {
      body = await req.json();
    }

    if (body.action === "save_url") {
      await serviceClient.from("user_gcal_settings").upsert({
        user_id: userId,
        ical_url: body.icalUrl || "",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      // Invalidate cache
      await serviceClient.from("gcal_cache").delete().eq("user_id", userId);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Fetch events (check cache first)
    const { data: cacheRow } = await serviceClient
      .from("gcal_cache")
      .select("events_json, fetched_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (cacheRow) {
      const cacheAge = Date.now() - new Date(cacheRow.fetched_at).getTime();
      if (cacheAge < CACHE_TTL_MS) {
        return new Response(JSON.stringify({
          events: cacheRow.events_json,
          cachedAt: cacheRow.fetched_at,
          fromCache: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 4. Cache miss or expired: fetch from Google
    const { data: settings } = await serviceClient
      .from("user_gcal_settings")
      .select("ical_url")
      .eq("user_id", userId)
      .maybeSingle();

    if (!settings?.ical_url) {
      return new Response(JSON.stringify({
        events: [],
        error: "No iCal URL configured",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Fetch iCal feed (server-side, no CORS)
    const icalResponse = await fetch(settings.ical_url, {
      headers: { "User-Agent": "SuperAgencia-GCal-Sensor/1.0" },
    });

    if (!icalResponse.ok) {
      return new Response(JSON.stringify({
        events: [],
        error: `Google Calendar responded with ${icalResponse.status}`,
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const icalData = await icalResponse.text();

    // 6. Parse with ical.js (RFC 5545 compliant)
    const events = parseICalFeed(icalData);

    // 7. Update cache
    const now = new Date().toISOString();
    await serviceClient.from("gcal_cache").upsert({
      user_id: userId,
      events_json: events,
      fetched_at: now,
    }, { onConflict: "user_id" });

    return new Response(JSON.stringify({
      events,
      cachedAt: now,
      fromCache: false,
      count: events.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[gcal-sync] Error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Internal server error",
      events: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
