import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

const storageKey = "stacklet.theme";
const ThemeContext = createContext<{
  dark: boolean;
  toggle: () => void;
} | null>(null);

function readPreference(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);

    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Follow the device setting when browser storage is unavailable.
  }

  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dark = preference === "system" ? systemDark : preference === "dark";

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => setSystemDark(media.matches);
    const syncPreference = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setPreference(readPreference());
    };

    syncSystem();
    media.addEventListener("change", syncSystem);
    window.addEventListener("storage", syncPreference);

    return () => {
      media.removeEventListener("change", syncSystem);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#141c18" : "#fafbf9");
  }, [dark]);

  const toggle = () => {
    const next = dark ? "light" : "dark";

    setPreference(next);

    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Keep the switch usable for this session even if saving is blocked.
    }
  };

  return <ThemeContext value={{ dark, toggle }}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) throw new Error("ThemeProvider is required");

  return context;
}
