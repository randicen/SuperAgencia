export const pad = (value: number) => String(value).padStart(2, '0');

export const formatLocalDate = (date: Date = new Date()): string => {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return `${y}-${m}-${d}`;
};

export const formatLocalDateTime = (date: Date = new Date()): string => {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
};

export const parseLocalDate = (value?: string | null, endOfDay = false): number | null => {
  if (!value) return null;

  const trimmed = value.trim();

  // Handle explicit local date with no time component: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (endOfDay) date.setHours(23, 59, 59, 999);
    else date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  // Handle common DD/MM/YYYY format
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    if (endOfDay) date.setHours(23, 59, 59, 999);
    else date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  // Normalize space-separated date/time values to ISO local
  const normalized = trimmed.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getTime();
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback.getTime();
};

export const formatLocalDateOrToday = (date?: string | number | Date | null): string => {
  if (!date) return formatLocalDate();
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return formatLocalDate();
  return formatLocalDate(parsed);
};
