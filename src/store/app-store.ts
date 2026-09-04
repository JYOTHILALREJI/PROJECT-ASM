import { create } from 'zustand';

export type AppView = 'documents' | 'noc_view' | 'dashboard' | 'employees' | 'employee_add' | 'employee_batch_add' | 'sites' | 'attendance' | 'attendance_copy' | 'all_logs' | 'notifications' | 'admins' | 'leave_requests' | 'cancellation_requests' | 'uniform_registry' | 'accounts' | 'advance' | 'consolidated_salary' | 'employee_hours_ledger' | 'employee_detail' | 'camps' | 'camp_detail' | 'profile' | 'settings';

interface AppState {
  currentView: AppView;
  sidebarOpen: boolean;
  selectedEmployeeId: string | null;
  selectedNocId: string | null;
  setCurrentView: (view: AppView) => void;
  setSidebarOpen: (open: boolean) => void;
  setSelectedEmployeeId: (id: string | null) => void;
  setSelectedNocId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'dashboard',
  sidebarOpen: true,
  selectedEmployeeId: null,
  selectedNocId: null,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setCurrentView: (currentView) => set({ currentView }),
  setSelectedEmployeeId: (selectedEmployeeId) => set({ selectedEmployeeId }),
  setSelectedNocId: (selectedNocId) => set({ selectedNocId }),
}));
