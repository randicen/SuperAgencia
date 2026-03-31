export const DEFAULT_LISTA_COLUMN_ORDER = [
  'nombre',
  'clientName',
  'totalValue',
  'financialProgress',
  'startDate',
  'dueDate',
  'priority',
  'slack',
  'estado',
  'duration',
  'progress',
] as const;

export const DEFAULT_LISTA_VISIBLE_COLUMNS = [
  'nombre',
  'clientName',
  'totalValue',
  'financialProgress',
  'startDate',
  'dueDate',
  'priority',
  'slack',
  'estado',
] as const;

export type ListaColumnId = typeof DEFAULT_LISTA_COLUMN_ORDER[number];

const VALID_COLUMN_IDS = new Set<string>(DEFAULT_LISTA_COLUMN_ORDER);

const sanitizeColumnArray = (value: unknown): ListaColumnId[] => {
  if (!Array.isArray(value)) return [];

  const unique = new Set<ListaColumnId>();
  value.forEach((entry) => {
    if (typeof entry === 'string' && VALID_COLUMN_IDS.has(entry)) {
      unique.add(entry as ListaColumnId);
    }
  });

  return [...unique];
};

export const normalizeStoredColumnOrder = (value: unknown): ListaColumnId[] => {
  const parsed = sanitizeColumnArray(value);
  const missing = DEFAULT_LISTA_COLUMN_ORDER.filter((id) => !parsed.includes(id));
  return [...parsed, ...missing];
};

export const normalizeStoredVisibleColumns = (value: unknown): ListaColumnId[] => {
  const parsed = sanitizeColumnArray(value);
  if (parsed.length === 0) {
    return [...DEFAULT_LISTA_VISIBLE_COLUMNS];
  }

  const withRequiredName = parsed.includes('nombre') ? parsed : ['nombre', ...parsed];
  return withRequiredName;
};
