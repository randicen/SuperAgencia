import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Project, Transaction, Client, BusinessRules, Note, ChatSession, Message } from '../types';
import { TEMPLATE_PROJECTS, TEMPLATE_TRANSACTIONS, DEFAULT_RULES, TEMPLATE_CLIENTS } from '../mockData';
import { runAutoScheduling } from '../utils/schedulingLogic';

// Initial migration helper to read from legacy localStorage keys if present
const getInitialState = <T>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
};

const stampProjectStartedAt = (project: Project, previousProject?: Project): Project => {
  const previousProgress = previousProject?.progress ?? 0;
  if (project.startedAt || project.progress <= 0 || previousProgress > 0) {
    return project;
  }

  return {
    ...project,
    startedAt: !project.autoSchedule && project.startDate ? project.startDate : new Date().toISOString()
  };
};

interface AgencyState {
  projects: Project[];
  transactions: Transaction[];
  clients: Client[];
  rules: BusinessRules;
  notes: Note[];
  chatSessions: ChatSession[];
  currentChatId: string;
  
  // Base Setters (For initialization/direct overwrite)
  setProjects: (projects: Project[] | ((prev: Project[]) => Project[])) => void;
  setTransactions: (transactions: Transaction[] | ((prev: Transaction[]) => Transaction[])) => void;
  setClients: (clients: Client[] | ((prev: Client[]) => Client[])) => void;
  setRules: (rules: BusinessRules | ((prev: BusinessRules) => BusinessRules)) => void;
  setNotes: (notes: Note[] | ((prev: Note[]) => Note[])) => void;
  setChatSessions: (sessions: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])) => void;
  setCurrentChatId: (id: string) => void;

  updateLastMod: () => void;
  
  // Business Actions
  handleAddProject: (newProject: Project) => void;
  handleUpdateProject: (updatedProject: Project) => void;
  handleDeleteProject: (projectId: string) => void;
  handleAddTransaction: (t: Transaction) => void;
  handleDeleteTransaction: (id: string) => void;
  handleUpdateClients: (newClients: Client[]) => void;
  handleDeleteClient: (clientId: string) => void;
  handleSaveNote: (n: Note) => void;
  handleDeleteNote: (id: string) => void;
  handleSetMessages: (action: Message[] | ((prev: Message[]) => Message[])) => void;
  handleNewChat: () => void;
  handleDeleteChat: (id: string) => void;

  // Auto-Scheduling interval tick
  tickAutoScheduling: () => void;
}

export const useAgencyStore = create<AgencyState>()(
  persist(
    (set, get) => ({
      projects: getInitialState('coo_projects', TEMPLATE_PROJECTS),
      transactions: getInitialState('coo_transactions', TEMPLATE_TRANSACTIONS),
      clients: getInitialState('coo_clients', TEMPLATE_CLIENTS),
      rules: getInitialState('coo_rules', DEFAULT_RULES),
      notes: getInitialState('coo_notes', []),
      chatSessions: getInitialState('coo_chat_sessions', [{ id: 'default', title: 'Nuevo Chat', messages: [], lastModified: Date.now() }]),
      currentChatId: localStorage.getItem('coo_current_chat_id') || 'default',

      setProjects: (projects) => set((state) => ({ projects: typeof projects === 'function' ? projects(state.projects) : projects })),
      setTransactions: (tx) => set((state) => ({ transactions: typeof tx === 'function' ? tx(state.transactions) : tx })),
      setClients: (cls) => set((state) => ({ clients: typeof cls === 'function' ? cls(state.clients) : cls })),
      setRules: (rules) => set((state) => ({ rules: typeof rules === 'function' ? rules(state.rules) : rules })),
      setNotes: (nts) => set((state) => ({ notes: typeof nts === 'function' ? nts(state.notes) : nts })),
      setChatSessions: (sessions) => set((state) => ({ chatSessions: typeof sessions === 'function' ? sessions(state.chatSessions) : sessions })),
      setCurrentChatId: (id) => set({ currentChatId: id }),

      updateLastMod: () => {
        localStorage.setItem('coo_last_local_mod', Date.now().toString());
      },

      handleAddProject: (newProject) => {
        const { projects, rules, updateLastMod } = get();
        let updatedList = [...projects, stampProjectStartedAt(newProject)];
        if (newProject.autoSchedule) { updatedList = runAutoScheduling(updatedList, rules); }
        set({ projects: updatedList });
        updateLastMod();
      },

      handleUpdateProject: (updatedProject) => {
        const { projects, rules, updateLastMod } = get();
        let updatedList = projects.map(p => p.id === updatedProject.id ? stampProjectStartedAt(updatedProject, p) : p);
        if (updatedProject.autoSchedule) { updatedList = runAutoScheduling(updatedList, rules); }
        set({ projects: updatedList });
        updateLastMod();
      },

      handleDeleteProject: (projectId) => {
        const { projects, rules, updateLastMod } = get();
        const filtered = projects.filter(p => p.id !== projectId);
        set({ projects: runAutoScheduling(filtered, rules) });
        updateLastMod();
      },

      handleAddTransaction: (t) => {
        const { updateLastMod } = get();
        set(state => ({ transactions: [...state.transactions, t] }));
        updateLastMod();
      },

      handleDeleteTransaction: (id) => {
        const { updateLastMod } = get();
        set(state => ({ transactions: state.transactions.filter(t => t.id !== id) }));
        updateLastMod();
      },

      handleUpdateClients: (newClients) => {
        const { updateLastMod } = get();
        set({ clients: newClients });
        updateLastMod();
      },

      handleDeleteClient: (clientId) => {
        const { projects, rules, updateLastMod } = get();
        set(state => ({ clients: state.clients.filter(c => c.id !== clientId) }));
        
        const filteredProjects = projects.filter(p => p.clientId !== clientId);
        set({ projects: runAutoScheduling(filteredProjects, rules) });
        updateLastMod();
      },

      handleSaveNote: (n) => {
        const { updateLastMod } = get();
        set(state => {
          const exists = state.notes.find(note => note.id === n.id);
          if (exists) return { notes: state.notes.map(note => note.id === n.id ? n : note) };
          return { notes: [...state.notes, n] };
        });
        updateLastMod();
      },

      handleDeleteNote: (id) => {
        const { updateLastMod } = get();
        set(state => ({ notes: state.notes.filter(n => n.id !== id) }));
        updateLastMod();
      },

      handleSetMessages: (action) => {
        const { currentChatId, updateLastMod } = get();
        updateLastMod();
        set(state => {
          const index = state.chatSessions.findIndex(s => s.id === currentChatId);
          if (index === -1) return state;

          const session = state.chatSessions[index];
          const newMessages = typeof action === 'function' ? action(session.messages) : action;

          const updatedSessions = [...state.chatSessions];
          updatedSessions[index] = { ...session, messages: newMessages, lastModified: Date.now() };
          return { chatSessions: updatedSessions };
        });
      },

      handleNewChat: () => {
         const { updateLastMod } = get();
         updateLastMod();
         set(state => {
           const newSession: ChatSession = { id: Math.random().toString(36).substr(2, 9), title: 'Nuevo Chat', messages: [], lastModified: Date.now() };
           return {
             chatSessions: [newSession, ...state.chatSessions],
             currentChatId: newSession.id
           };
         });
      },

      handleDeleteChat: (id) => {
        const { currentChatId, updateLastMod } = get();
        updateLastMod();
        set(state => {
          const filtered = state.chatSessions.filter(s => s.id !== id);
          if (filtered.length === 0) {
            const newSession: ChatSession = { id: Math.random().toString(36).substr(2, 9), title: 'Nuevo Chat', messages: [], lastModified: Date.now() };
            return {
              chatSessions: [newSession],
              currentChatId: newSession.id
            };
          }
          let newCurrentChatId = currentChatId;
          if (currentChatId === id) {
             newCurrentChatId = filtered[0].id;
          }
          return {
            chatSessions: filtered,
            currentChatId: newCurrentChatId
          };
        });
      },

      tickAutoScheduling: () => {
        const { projects, rules } = get();
        const hasActiveProjects = projects.some(p => p.status !== 'completed');
        if (hasActiveProjects) {
            set({ projects: runAutoScheduling(projects, rules) });
        }
      }
    }),
    {
      name: 'agency-store', // Clave única de persistencia centralizada en localStorage
      version: 1, // Para futuras migraciones
    }
  )
);
