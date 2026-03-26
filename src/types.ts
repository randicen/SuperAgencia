
export enum Priority {
  ASAP = 'ASAP',
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low'
}

export interface Installment {
  id: string;
  amount: number;
  dueDate: string;
  paidDate?: string;
  status: 'PENDIENTE' | 'PAGADO';
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface ScheduledSlot {
  id: string;
  start: string;
  end: string;
  isFragment: boolean;
}

export interface Project {
  id: string;
  clientId: string;
  clientName: string;
  projectName: string;
  startedAt?: string;
  startDate: string;
  endDate: string;
  priority: Priority;
  progress: number;
  totalValue: number;
  paidValue: number;
  status: 'active' | 'completed' | 'todo' | 'proposal';
  duration: number;
  deadlineType: 'Hard Deadline' | 'Soft Deadline';
  dueDate: string;
  autoSchedule: boolean;
  elasticity?: number; // 0 = Indivisible (Rígido), 1 = Divisible (Flexible)
  scheduledSlots?: ScheduledSlot[];
  hasConflict?: boolean;
  conflictDescription?: string;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  isPredictive: boolean;
  projectId?: string;
}

export interface BusinessRules {
  baseHourlyRate: number;
  urgencyThresholdDays: number;
  urgencyMarkup: number;
  maxProjectsCapacity: number;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  gcalIcalUrl?: string;
  customRules: string;
  historicalSeasonality: Record<string, number>;
}

export interface Attachment {
  name: string;
  type: string;
  content: string;
  isBinary: boolean;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  pendingActions?: any[];
  executedActions?: any[];
  attachments?: Attachment[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  lastModified: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  lastModified: number;
  tags?: string[];
}

export interface SeasonalityData {
  month: string;
  intensity: number;
}
