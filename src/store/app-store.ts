import { create } from 'zustand';

export type AppView = 'dashboard' | 'employees' | 'sites' | 'attendance' | 'attendance_copy' | 'all_logs' | 'notifications' | 'admins' | 'leave_requests' | 'cancellation_requests' | 'uniform_registry' | 'accounts' | 'advance' | 'consolidated_salary' | 'employee_hours_ledger' | 'profile';

interface AppState {
  currentView: AppView;
  sidebarOpen: boolean;
  selectedEmployeeId: string | null;
  setCurrentView: (view: AppView) => void;
  setSidebarOpen: (open: boolean) => void;
  setSelectedEmployeeId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'dashboard',
  sidebarOpen: true,
  selectedEmployeeId: null,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setCurrentView: (currentView) => set({ currentView }),
  setSelectedEmployeeId: (selectedEmployeeId) => set({ selectedEmployeeId }),
}));
