// Google Calendar Sensor Hook
// Clean, portable abstraction over the gcal-sync Edge Function.
// Works identically in web (Vite/React) and mobile (React Native).

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../contexts/AuthContext';
import { SpaceEvent } from '../spacesTypes';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const EDGE_FUNCTION_NAME = 'gcal-sync';

interface GCalSensorState {
    events: SpaceEvent[];
    isLoading: boolean;
    error: string | null;
    lastSynced: string | null;
    fromCache: boolean;
}

interface UseGCalSensorReturn extends GCalSensorState {
    connectOAuth: () => Promise<void>;
    refresh: () => Promise<void>;
}

export const useGCalSensor = (): UseGCalSensorReturn => {
    const [state, setState] = useState<GCalSensorState>({
        events: [],
        isLoading: false,
        error: null,
        lastSynced: null,
        fromCache: false,
    });

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchEvents = useCallback(async () => {
        // Use a functional update to check loading state without depending on it
        setState(prev => {
            if (prev.isLoading) return prev;
            
            // We can't do async inside setState functional updates, 
            // but we can trigger the flow. For simplicity here:
            return { ...prev, isLoading: true, error: null };
        });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setState(prev => ({ ...prev, isLoading: false }));
                return;
            }

            const { data, error } = await supabase.functions.invoke(EDGE_FUNCTION_NAME, {
                body: { action: 'fetch' },
            });

            if (error) throw new Error(error.message);

            if (data?.error === 'No Google account connected') {
                setState(prev => ({ ...prev, isLoading: false, events: [], error: null }));
                return;
            }

            if (data?.error) throw new Error(data.error);

            const events: SpaceEvent[] = (data.events || []).map((e: any) => ({
                id: e.id,
                nombre: e.nombre,
                startDate: e.startDate,
                endDate: e.endDate,
                description: e.description,
            }));

            setState({
                events,
                isLoading: false,
                error: null,
                lastSynced: data.cachedAt || new Date().toISOString(),
                fromCache: data.fromCache || false,
            });

            console.log(`[GCal Sensor] ${events.length} Google events loaded.`);
        } catch (err) {
            console.error('[GCal Sensor] Error:', err);
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: err instanceof Error ? err.message : 'Error desconocido',
            }));
        }
    }, []); // Empty dependencies to prevent infinite loops

    const connectOAuth = useCallback(async () => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent',
                    },
                    scopes: 'https://www.googleapis.com/auth/calendar.readonly',
                },
            });

            if (error) throw error;
        } catch (err) {
            console.error('[GCal Sensor] OAuth error:', err);
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: err instanceof Error ? err.message : 'Error al conectar con Google',
            }));
        }
    }, []);

    // Initial fetch + polling
    useEffect(() => {
        fetchEvents();

        intervalRef.current = setInterval(fetchEvents, POLL_INTERVAL_MS);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [fetchEvents]);

    return {
        ...state,
        connectOAuth,
        refresh: fetchEvents,
    };
};
