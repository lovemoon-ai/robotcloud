import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { AuthSession, UserRole } from "@/types";

interface AuthState {
  token?: string;
  role?: UserRole;
  phone?: string;
  userId?: number;
  expireAt?: string | null;
  setAuth: (session: AuthSession) => void;
  setRole: (role: UserRole, expireAt?: string | null) => void;
  restoreFromStorage: () => boolean;
  restoreFromDesktopBridge: () => Promise<boolean>;
  reset: () => void;
}

type AuthPersistedState = Pick<AuthState, "token" | "role" | "phone" | "userId" | "expireAt">;

const STORAGE_KEY = "robotcloud-auth";
const USER_ROLES = new Set<UserRole>(["free", "plus", "pro", "admin"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPersistedAuthState(): AuthPersistedState | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed;
    if (!isRecord(state) || typeof state.token !== "string" || state.token.length === 0) {
      return null;
    }

    const role = typeof state.role === "string" && USER_ROLES.has(state.role as UserRole) ? (state.role as UserRole) : undefined;
    const userId = typeof state.userId === "number" && Number.isFinite(state.userId) ? state.userId : undefined;
    const phone = typeof state.phone === "string" ? state.phone : undefined;
    const expireAt = typeof state.expireAt === "string" || state.expireAt === null ? state.expireAt : undefined;

    return {
      token: state.token,
      role,
      phone,
      userId,
      expireAt
    };
  } catch {
    return null;
  }
}

const createStorage = () =>
  createJSONStorage<AuthPersistedState>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    const memoryStorage: Record<string, string> = {};
    return {
      getItem: (name: string) => memoryStorage[name] ?? null,
      setItem: (name: string, value: string) => {
        memoryStorage[name] = value;
      },
      removeItem: (name: string) => {
        delete memoryStorage[name];
      },
      clear: () => {
        for (const key of Object.keys(memoryStorage)) {
          delete memoryStorage[key];
        }
      },
      key: (index: number) => Object.keys(memoryStorage)[index] ?? null,
      get length() {
        return Object.keys(memoryStorage).length;
      }
    };
  });

const initialState = (): AuthPersistedState => ({
  token: undefined,
  role: undefined,
  phone: undefined,
  userId: undefined,
  expireAt: undefined
});

function desktopAuthBridge() {
  if (typeof window === "undefined") return undefined;
  return window.robotcloudDesktop?.auth;
}

function persistDesktopAuthSession(session: AuthSession): void {
  const bridge = desktopAuthBridge();
  if (!bridge?.setSession) return;
  Promise.resolve(bridge.setSession(session)).catch(() => undefined);
}

function clearDesktopAuthSession(): void {
  const bridge = desktopAuthBridge();
  if (!bridge?.clearSession) return;
  Promise.resolve(bridge.clearSession()).catch(() => undefined);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...initialState(),
      setAuth: (session) => {
        set({
          token: session.token,
          role: session.role,
          phone: session.phone,
          userId: session.userId,
          expireAt: session.expireAt
        });
        persistDesktopAuthSession(session);
      },
      setRole: (role, expireAt) => {
        set((state) => ({
          ...state,
          role,
          expireAt: expireAt ?? state.expireAt
        }));
        const current = get();
        if (current.token && current.phone && typeof current.userId === "number") {
          persistDesktopAuthSession({
            token: current.token,
            userId: current.userId,
            phone: current.phone,
            role,
            expireAt: current.expireAt ?? null
          });
        }
      },
      restoreFromStorage: () => {
        const persistedAuth = readPersistedAuthState();
        if (!persistedAuth) {
          return false;
        }
        set(persistedAuth);
        return true;
      },
      restoreFromDesktopBridge: async () => {
        const bridge = desktopAuthBridge();
        if (!bridge?.getSession) {
          return false;
        }
        try {
          const session = await bridge.getSession();
          if (!session) {
            return false;
          }
          set(session);
          return true;
        } catch {
          return false;
        }
      },
      reset: () => {
        set(initialState());
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.removeItem(STORAGE_KEY);
        }
        clearDesktopAuthSession();
      }
    }),
    {
      name: STORAGE_KEY,
      storage: createStorage(),
      partialize: (state) => ({
        token: state.token,
        role: state.role,
        phone: state.phone,
        userId: state.userId,
        expireAt: state.expireAt
      })
    }
  )
);
