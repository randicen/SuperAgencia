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
    saveIcalUrl: (url: string) => Promise<boolean>;
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
        setState(prev => ({ ...prev, isLoading: true, error: null }));

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

            if (data?.error === 'No iCal URL configured') {
                setState(prev => ({ ...prev, isLoading: false, events: [] }));
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

            console.log(`[GCal Sensor] ${events.length} events loaded (cache: ${data.fromCache})`);
        } catch (err) {
            console.error('[GCal Sensor] Error:', err);
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: err instanceof Error ? err.message : 'Error desconocido',
            }));
        }
    }, []);

    const saveIcalUrl = useCallback(async (url: string): Promise<boolean> => {
        try {
            const { error } = await supabase.functions.invoke(EDGE_FUNCTION_NAME, {
                body: { action: 'save_url', icalUrl: url },
            });

            if (error) throw new Error(error.message);

            // After saving, immediately fetch fresh events
            await fetchEvents();
            return true;
        } catch (err) {
            console.error('[GCal Sensor] Save URL error:', err);
            setState(prev => ({
                ...prev,
                error: err instanceof Error ? err.message : 'Error al guardar URL',
            }));
            return false;
        }
    }, [fetchEvents]);

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
        saveIcalUrl,
        refresh: fetchEvents,
    };
};
