import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The UI is a pure client (the Nostr relay is its only "API"), so this is a
// plain SPA build with no server-side anything.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5273,
  },
});
