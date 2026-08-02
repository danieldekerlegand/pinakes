import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa/register";

createRoot(document.getElementById("root")!).render(<App />);

// PWA: register the service worker in production only (US-011). Dev relies on
// Vite HMR, which a service worker would interfere with. Runs after render so it
// never blocks first paint.
registerServiceWorker({ isProduction: import.meta.env.PROD });
