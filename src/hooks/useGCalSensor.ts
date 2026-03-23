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
        setState(prev => {
            if (prev.isLoading) return prev;
            return { ...prev, isLoading: true, error: null };
        });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            
            // Get provider token directly from session
            const providerToken = (session as any)?.provider_token;

            if (!session || !providerToken) {
                console.log('[GCal Sensor] No Google session or provider token found.');
                setState(prev => ({ ...prev, isLoading: false }));
                return;
            }

            // Fetch DIRECTLY from Google API
            const response = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${new Date().toISOString()}&maxResults=50&singleEvents=true&orderBy=startTime`,
                {
                    headers: { Authorization: `Bearer ${providerToken}` },
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                // If token expired, sign out or prompt reconnect
                if (response.status === 401) {
                    throw new Error('Sextion de Google expirada. Por favor, vuelve a vincular tu cuenta.');
                }
                throw new Error(errorData.error?.message || 'Error al conectar con Google');
            }

            const data = await response.json();
            
            const events: SpaceEvent[] = (data.items || []).map((item: any) => ({
                id: item.id,
                nombre: item.summary || 'Evento sin título',
                startDate: item.start.dateTime || item.start.date,
                endDate: item.end.dateTime || item.end.date,
                description: item.description || '',
            }));

            setState({
                events,
                isLoading: false,
                error: null,
                lastSynced: new Date().toISOString(),
                fromCache: false,
            });

            console.log(`[GCal Sensor] ${events.length} Google events fetched directly.`);
        } catch (err) {
            console.error('[GCal Sensor] Error:', err);
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: err instanceof Error ? err.message : 'Error desconocido',
            }));
        }
    }, []);

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
