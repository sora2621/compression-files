"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type LanguagePreference = "ja" | "en";
export type RetentionMinutes = 10 | 30 | 60;

export interface AppPreferences {
  theme: ThemePreference;
  language: LanguagePreference;
  retentionMinutes: RetentionMinutes;
}

export interface HistoryEntry {
  jobId: string;
  kind: "image" | "video" | "audio";
  originalName: string;
  outputName: string;
  originalSize: number;
  outputSize: number;
  reductionPercent: number;
  outputFormat: string;
  downloadUrl: string;
  createdAt: string;
  expiresAt: string;
}

interface ToastMessage {
  id: string;
  message: string;
  tone: "info" | "success" | "warning" | "error";
}

interface WorkspaceContextValue {
  files: File[];
  setFiles: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  removeFile: (file: File) => void;
  clearFiles: () => void;
  preferences: AppPreferences;
  updatePreferences: (update: Partial<AppPreferences>) => void;
  history: HistoryEntry[];
  addHistory: (entry: HistoryEntry) => void;
  removeHistory: (jobId: string) => void;
  clearHistory: () => void;
  toast: ToastMessage | null;
  showToast: (message: string, tone?: ToastMessage["tone"]) => void;
  dismissToast: () => void;
  hydrated: boolean;
}

const PREFERENCES_KEY = "compression-files:preferences:v1";
const HISTORY_KEY = "compression-files:history:v1";
const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "system",
  language: "ja",
  retentionMinutes: 30,
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<File[]>([]);
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedPreferences = safeRead(PREFERENCES_KEY, DEFAULT_PREFERENCES);
      const storedHistory = safeRead<HistoryEntry[]>(HISTORY_KEY, []);
      setPreferences({ ...DEFAULT_PREFERENCES, ...storedPreferences });
      setHistory(
        storedHistory.filter(
          (entry) =>
            entry &&
            typeof entry.jobId === "string" &&
            new Date(entry.expiresAt).getTime() > Date.now(),
        ),
      );
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark =
        preferences.theme === "dark" || (preferences.theme === "system" && media.matches);
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };
    applyTheme();
    root.lang = preferences.language;
    if (preferences.theme === "system") {
      media.addEventListener("change", applyTheme);
      return () => media.removeEventListener("change", applyTheme);
    }
  }, [hydrated, preferences]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 60)));
  }, [history, hydrated]);

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((current) => {
      const known = new Set(
        current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
      );
      const unique = incoming.filter(
        (file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`),
      );
      return [...current, ...unique].slice(0, 10);
    });
  }, []);

  const removeFile = useCallback((target: File) => {
    setFiles((current) => current.filter((file) => file !== target));
  }, []);

  const updatePreferences = useCallback((update: Partial<AppPreferences>) => {
    setPreferences((current) => ({ ...current, ...update }));
  }, []);

  const addHistory = useCallback((entry: HistoryEntry) => {
    setHistory((current) =>
      [entry, ...current.filter((item) => item.jobId !== entry.jobId)].slice(0, 60),
    );
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastMessage["tone"] = "info") => {
      setToast({ id: crypto.randomUUID(), message, tone });
    },
    [],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      files,
      setFiles,
      addFiles,
      removeFile,
      clearFiles: () => setFiles([]),
      preferences,
      updatePreferences,
      history,
      addHistory,
      removeHistory: (jobId) =>
        setHistory((current) => current.filter((entry) => entry.jobId !== jobId)),
      clearHistory: () => setHistory([]),
      toast,
      showToast,
      dismissToast: () => setToast(null),
      hydrated,
    }),
    [
      addFiles,
      addHistory,
      files,
      history,
      hydrated,
      preferences,
      removeFile,
      showToast,
      toast,
      updatePreferences,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider is missing");
  return value;
}
