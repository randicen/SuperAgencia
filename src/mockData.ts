
import { Project, Transaction, BusinessRules, Client } from './types';

export const TEMPLATE_PROJECTS: Project[] = [];

export const TEMPLATE_TRANSACTIONS: Transaction[] = [];

export const TEMPLATE_CLIENTS: Client[] = [];

export const DEFAULT_RULES: BusinessRules = {
  baseHourlyRate: 50,
  urgencyThresholdDays: 5,
  urgencyMarkup: 25,
  maxProjectsCapacity: 5,
  workingDays: [1, 2, 3, 4, 5],
  workingHoursStart: "09:00",
  workingHoursEnd: "17:00",
  gcalIcalUrl: "",
  customRules: "valor: correccion de formato = 5.000 COP por pagina",
  historicalSeasonality: {
    'Ene': 0, 'Feb': 0, 'Mar': 0, 'Abr': 0, 'May': 0, 'Jun': 0,
    'Jul': 0, 'Ago': 0, 'Sep': 0, 'Oct': 0, 'Nov': 0, 'Dic': 0
  }
};
