const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_DATE_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

const hasExplicitTime = (value: string) => value.includes('T') || value.includes(':');

export const parseLocalDate = (value?: string | null, endOfDay = false): Date | null => {
  if (!value) return null;

  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (SLASH_DATE_PATTERN.test(value)) {
    const [day, month, year] = value.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  if (endOfDay && !hasExplicitTime(value)) {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
};

export const parseLocalTimestamp = (value?: string | null, endOfDay = false): number | null => {
  const parsed = parseLocalDate(value, endOfDay);
  return parsed ? parsed.getTime() : null;
};
