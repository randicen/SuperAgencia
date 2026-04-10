import type { ReplanningImpactSummary } from '../../src/lib/plannerState.js';
import type { ReplanningTrigger } from '../replanning/types.js';

type ReplanningEmailType =
  | 'replanning_applied'
  | 'replanning_suggested'
  | 'replanning_ignored_due_to_guardrails'
  | 'replanning_failed';

type SendReplanningEmailParams = {
  to: string;
  fullName?: string;
  emailType: ReplanningEmailType;
  trigger: ReplanningTrigger;
  reason: string;
  impactSummary: ReplanningImpactSummary | null;
};

type SendTestEmailParams = {
  to: string;
  fullName?: string;
};

const getEnv = (name: string): string | null => process.env[name]?.trim() || null;

const formatImpact = (impact: ReplanningImpactSummary | null): string => {
  if (!impact) return 'No hubo cambios aplicados en la agenda.';
  return [
    `Tareas movidas: ${impact.movedTaskCount}`,
    `Minutos desplazados: ${impact.totalDisplacedMinutes}`,
    `Toco tareas fijas: ${impact.touchesFixedStart ? 'si' : 'no'}`,
    `Toco tareas criticas: ${impact.touchesCritical ? 'si' : 'no'}`,
    `Empujo algo fuera del dia: ${impact.pushedOutsideCurrentDay ? 'si' : 'no'}`,
  ].join('<br/>');
};

const emailTitles: Record<ReplanningEmailType, string> = {
  replanning_applied: 'Tandeba reajusto tu agenda',
  replanning_suggested: 'Tandeba preparo una propuesta de reajuste',
  replanning_ignored_due_to_guardrails: 'Tandeba detecto un cambio, pero no movio tu agenda',
  replanning_failed: 'Tandeba no pudo completar una replanificacion',
};

export const sendReplanningEmail = async (
  params: SendReplanningEmailParams,
): Promise<{ id: string | null }> => {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getEnv('RESEND_FROM_EMAIL');
  const appUrl = getEnv('PUBLIC_APP_URL');

  if (!apiKey || !from) {
    return { id: null };
  }

  const subject = emailTitles[params.emailType];
  const greeting = params.fullName ? `Hola ${params.fullName},` : 'Hola,';
  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
      <p>${greeting}</p>
      <p><strong>${subject}</strong></p>
      <p>${params.trigger.summary}</p>
      <p>${params.reason}</p>
      <p>${formatImpact(params.impactSummary)}</p>
      ${appUrl ? `<p><a href="${appUrl}" style="color:#2563eb;">Abrir Tandeba</a></p>` : ''}
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend rejected replanning email: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as { id?: string };
  return { id: payload.id ?? null };
};

export const sendTestEmail = async (params: SendTestEmailParams): Promise<{ id: string | null }> => {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getEnv('RESEND_FROM_EMAIL');
  const appUrl = getEnv('PUBLIC_APP_URL');

  if (!apiKey || !from) {
    return { id: null };
  }

  const greeting = params.fullName ? `Hola ${params.fullName},` : 'Hola,';
  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
      <p>${greeting}</p>
      <p><strong>Correo de prueba de Tandeba</strong></p>
      <p>Este mensaje confirma que la configuracion de Resend y el dominio remitente ya estan funcionando.</p>
      ${appUrl ? `<p><a href="${appUrl}" style="color:#2563eb;">Abrir Tandeba</a></p>` : ''}
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: 'Correo de prueba de Tandeba',
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend rejected test email: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as { id?: string };
  return { id: payload.id ?? null };
};
