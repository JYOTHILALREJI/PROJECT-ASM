import { create } from 'zustand';

export type UserRole = 'super_admin' | 'admin';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

interface AuthState {
  user: UserSession | null;
  isLoading: boolean;
  // Granted permission slugs for normal admins (mirrored from page.tsx's 15s
  // poll). Super admins keep this empty — every view is allowed for them.
  // The AI agent reads this to enforce the SAME access rules as the human UI.
  permissions: string[];
  setUser: (user: UserSession | null) => void;
  setPermissions: (slugs: string[]) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
  updateUser: (updates: Partial<UserSession>) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  permissions: [],
  setPermissions: (permissions) => set({ permissions }),
  setUser: (user) => {
    if (typeof window !== 'undefined') {
      if (user) {
        localStorage.setItem('asm_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('asm_user');
      }
    }
    // A different account means a different permission set — never leak the
    // previous account's grants into the new session.
    set({ user, permissions: [], isLoading: false });
  },
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('asm_user');
    }
    set({ user: null, permissions: [], isLoading: false });
  },
  updateUser: (updates) => {
    set((state) => {
      if (!state.user) return state;
      const updatedUser = { ...state.user, ...updates };
      if (typeof window !== 'undefined') {
        localStorage.setItem('asm_user', JSON.stringify(updatedUser));
      }
      return { user: updatedUser };
    });
  },
  init: () => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('asm_user');
        if (stored) {
          const user = JSON.parse(stored) as UserSession;
          set({ user, isLoading: false });
          return;
        }
      } catch {
        // ignore parse errors
      }
    }
    set({ isLoading: false });
  },
}));
