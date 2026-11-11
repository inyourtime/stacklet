import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app";
import { RequestError } from "./lib/api";
import { AmountVisibilityProvider } from "./lib/amount-visibility";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        !(error instanceof RequestError && error.status < 500) && count < 1,
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AmountVisibilityProvider>
          <App />
        </AmountVisibilityProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
