import { supabase } from '../contexts/AuthContext';
import { Project, Client, Transaction, BusinessRules, Note, ChatSession } from '../types';

type SupabaseResponse<T> = {
    data: T;
    error: { message: string } | null;
};

const unwrapSupabaseResponse = <T>(label: string, response: SupabaseResponse<T>): T => {
    if (response.error) {
        throw new Error(`[syncManager] ${label}: ${response.error.message}`);
    }

    return response.data;
};

const runSupabaseMutation = async (label: string, operation: Promise<SupabaseResponse<unknown>>) => {
    unwrapSupabaseResponse(label, await operation);
};

export const uploadRelationalState = async (
    userId: string,
    projects: Project[],
    clients: Client[],
    transactions: Transaction[],
    rules: BusinessRules,
    notes: Note[],
    chatSessions: ChatSession[]
) => {
    const nowIso = new Date().toISOString();

    // 1. Projects
    const projectPayload = projects.map(p => ({
        id: p.id, user_id: userId, client_id: p.clientId, client_name: p.clientName,
        project_name: p.projectName, start_date: p.startDate, end_date: p.endDate,
        due_date: p.dueDate, priority: p.priority, progress: p.progress,
        total_value: p.totalValue, paid_value: p.paidValue, status: p.status,
        duration: p.duration, deadline_type: p.deadlineType, auto_schedule: p.autoSchedule,
        elasticity: p.elasticity, scheduled_slots: p.scheduledSlots,
        has_conflict: p.hasConflict, conflict_description: p.conflictDescription,
        updated_at: nowIso
    }));
    if (projectPayload.length > 0) {
        await runSupabaseMutation('upsert projects', supabase.from('projects').upsert(projectPayload));
    }

    // Hard-delete removed projects — ONLY if local list has items (safety guard against empty-wipe)
    const pIds = projects.map(p => p.id);
    if (pIds.length > 0) {
        await runSupabaseMutation(
            'delete removed projects',
            supabase.from('projects').delete().eq('user_id', userId).not('id', 'in', `(${pIds.join(',')})`)
        );
    }

    // 2. Clients
    const clientPayload = clients.map(c => ({
        id: c.id, user_id: userId, name: c.name, email: c.email, phone: c.phone,
        updated_at: nowIso
    }));
    if (clientPayload.length > 0) {
        await runSupabaseMutation('upsert clients', supabase.from('clients').upsert(clientPayload));
    }

    // Hard-delete removed clients — ONLY if local list has items (safety guard)
    const cIds = clients.map(c => c.id);
    if (cIds.length > 0) {
        await runSupabaseMutation(
            'delete removed clients',
            supabase.from('clients').delete().eq('user_id', userId).not('id', 'in', `(${cIds.join(',')})`)
        );
    }

    // 3. Transactions
    const txPayload = transactions.map(t => ({
        id: t.id, user_id: userId, date: t.date, description: t.description,
        amount: t.amount, type: t.type, category: t.category,
        is_predictive: t.isPredictive, project_id: t.projectId,
        updated_at: nowIso
    }));
    if (txPayload.length > 0) {
        await runSupabaseMutation('upsert transactions', supabase.from('transactions').upsert(txPayload));
    }

    // Hard-delete removed transactions — ONLY if local list has items (safety guard)
    const tIds = transactions.map(t => t.id);
    if (tIds.length > 0) {
        await runSupabaseMutation(
            'delete removed transactions',
            supabase.from('transactions').delete().eq('user_id', userId).not('id', 'in', `(${tIds.join(',')})`)
        );
    }

    // 4. Notes
    const notesPayload = notes.map(n => ({
        id: n.id, user_id: userId, title: n.title, content: n.content,
        last_modified: n.lastModified, tags: n.tags,
        updated_at: nowIso
    }));
    if (notesPayload.length > 0) {
        await runSupabaseMutation('upsert notes', supabase.from('notes').upsert(notesPayload));
    }

    // Hard-delete removed notes — ONLY if local list has items (safety guard)
    const nIds = notes.map(n => n.id);
    if (nIds.length > 0) {
        await runSupabaseMutation(
            'delete removed notes',
            supabase.from('notes').delete().eq('user_id', userId).not('id', 'in', `(${nIds.join(',')})`)
        );
    }

    // 5. Chat Sessions
    const chatPayload = chatSessions.map(cs => ({
        id: cs.id, user_id: userId, title: cs.title, messages: cs.messages,
        last_modified: cs.lastModified,
        updated_at: nowIso
    }));
    if (chatPayload.length > 0) {
        await runSupabaseMutation('upsert chat sessions', supabase.from('chat_sessions').upsert(chatPayload));
    }

    // Hard-delete removed chat sessions — ONLY if local list has items (safety guard)
    const csIds = chatSessions.map(cs => cs.id);
    if (csIds.length > 0) {
        await runSupabaseMutation(
            'delete removed chat sessions',
            supabase.from('chat_sessions').delete().eq('user_id', userId).not('id', 'in', `(${csIds.join(',')})`)
        );
    }

    // 6. Business Rules (Singular)
    await runSupabaseMutation('upsert business rules', supabase.from('business_rules').upsert({
        user_id: userId,
        base_hourly_rate: rules.baseHourlyRate,
        urgency_threshold_days: rules.urgencyThresholdDays,
        urgency_markup: rules.urgencyMarkup,
        max_projects_capacity: rules.maxProjectsCapacity,
        working_days: rules.workingDays,
        working_hours_start: rules.workingHoursStart,
        working_hours_end: rules.workingHoursEnd,
        gcal_ical_url: rules.gcalIcalUrl,
        custom_rules: rules.customRules,
        historical_seasonality: rules.historicalSeasonality,
        updated_at: nowIso
    }));

};

export const downloadRelationalState = async (userId: string) => {
    const [
        projectsResult,
        clientsResult,
        transactionsResult,
        notesResult,
        rulesResult,
        chatSessionsResult
    ] = await Promise.all([
        supabase.from('projects').select('*').eq('user_id', userId),
        supabase.from('clients').select('*').eq('user_id', userId),
        supabase.from('transactions').select('*').eq('user_id', userId),
        supabase.from('notes').select('*').eq('user_id', userId),
        supabase.from('business_rules').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('chat_sessions').select('*').eq('user_id', userId)
    ]);

    const projects = unwrapSupabaseResponse('select projects', projectsResult);
    const clients = unwrapSupabaseResponse('select clients', clientsResult);
    const transactions = unwrapSupabaseResponse('select transactions', transactionsResult);
    const notes = unwrapSupabaseResponse('select notes', notesResult);
    const rules = unwrapSupabaseResponse('select business rules', rulesResult);
    const chatSessions = unwrapSupabaseResponse('select chat sessions', chatSessionsResult);
    const relationalIsEmpty =
        !projects?.length &&
        !clients?.length &&
        !transactions?.length &&
        !notes?.length &&
        !chatSessions?.length &&
        !rules;

    // ── FALLBACK: Si las tablas relacionales están vacías, intentar migrar desde app_state_dump ──
    if (relationalIsEmpty) {
        console.log('🔄 Tablas relacionales vacías. Buscando datos en app_state_dump (blob legacy)...');
        const legacyResult = await supabase
            .from('app_state_dump')
            .select('data')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        const legacyRow = unwrapSupabaseResponse('select app_state_dump fallback', legacyResult);

        if (legacyRow?.data) {
            const d = legacyRow.data as any;
            console.log('✅ Datos legacy encontrados. Migrando a tablas relacionales...');

            // Devolver datos del blob al App.tsx  
            const legacyState = {
                projects: d.projects || [],
                clients: d.clients || [],
                transactions: d.transactions || [],
                notes: d.notes || [],
                chatSessions: d.chatSessions || [],
                rules: d.rules || null,
                isEmpty: false,
                _migratedFromLegacy: true  // Flag para que App.tsx sepa que debe disparar upload
            };

            // Auto-migración: escribir los datos legacy en las tablas relacionales
            try {
                await uploadRelationalState(
                    userId,
                    legacyState.projects,
                    legacyState.clients,
                    legacyState.transactions,
                    legacyState.rules || {} as any,
                    legacyState.notes,
                    legacyState.chatSessions
                );
                console.log('✅ Migración legacy → relacional completada.');
            } catch (migErr) {
                console.warn('⚠️ Migración automática falló (los datos aún se cargaron desde el blob):', migErr);
            }

            return legacyState;
        }
    }

    return {
        projects: projects?.map((p: any) => ({
            id: p.id, clientId: p.client_id, clientName: p.client_name,
            projectName: p.project_name, startDate: p.start_date, endDate: p.end_date,
            dueDate: p.due_date, priority: p.priority, progress: p.progress,
            totalValue: p.total_value, paidValue: p.paid_value, status: p.status,
            duration: p.duration, deadlineType: p.deadline_type, autoSchedule: p.auto_schedule,
            elasticity: p.elasticity, scheduledSlots: p.scheduled_slots,
            hasConflict: p.has_conflict, conflictDescription: p.conflict_description
        })) || [],
        clients: clients?.map((c: any) => ({
            id: c.id, name: c.name, email: c.email, phone: c.phone
        })) || [],
        transactions: transactions?.map((t: any) => ({
            id: t.id, date: t.date, description: t.description,
            amount: t.amount, type: t.type, category: t.category,
            isPredictive: t.is_predictive, projectId: t.project_id
        })) || [],
        notes: notes?.map((n: any) => ({
            id: n.id, title: n.title, content: n.content,
            lastModified: n.last_modified, tags: n.tags
        })) || [],
        chatSessions: chatSessions?.map((cs: any) => ({
            id: cs.id, title: cs.title, messages: cs.messages,
            lastModified: cs.last_modified
        })) || [],
        rules: rules ? {
            baseHourlyRate: rules.base_hourly_rate,
            urgencyThresholdDays: rules.urgency_threshold_days,
            urgencyMarkup: rules.urgency_markup,
            maxProjectsCapacity: rules.max_projects_capacity,
            workingDays: rules.working_days,
            workingHoursStart: rules.working_hours_start,
            workingHoursEnd: rules.working_hours_end,
            gcalIcalUrl: rules.gcal_ical_url,
            customRules: rules.custom_rules,
            historicalSeasonality: rules.historical_seasonality
        } : null,
        isEmpty: relationalIsEmpty
    };
};
