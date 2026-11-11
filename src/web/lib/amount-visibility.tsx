import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { displayThb } from "../../shared/money";

const storageKey = "stacklet.amountsHidden";
const mask = "••••••";
const AmountVisibilityContext = createContext<{
  hidden: boolean;
  toggle: () => void;
} | null>(null);

function readPreference() {
  try {
    return localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

export function AmountVisibilityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState(readPreference);

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        setHidden(readPreference());
      }
    };

    window.addEventListener("storage", syncPreference);

    return () => window.removeEventListener("storage", syncPreference);
  }, []);

  const toggle = () => {
    const next = !hidden;

    setHidden(next);

    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Keep the toggle usable for this session if browser storage is unavailable.
    }
  };

  return (
    <AmountVisibilityContext value={{ hidden, toggle }}>
      {children}
    </AmountVisibilityContext>
  );
}

export function useAmountVisibility() {
  const context = useContext(AmountVisibilityContext);

  if (!context) throw new Error("AmountVisibilityProvider is required");

  return {
    ...context,
    money: (value: string) => (context.hidden ? mask : displayThb(value)),
    quantity: (value: string) => (context.hidden ? mask : value),
  };
}
