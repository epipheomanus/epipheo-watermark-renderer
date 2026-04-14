import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { serveStatic, setupVite } from "./vite";
import renderRoutes from "../renderRoutes";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Render API routes — always available, no auth required
  app.use("/api", renderRoutes);

  // Only register OAuth and tRPC if the Manus platform env vars are present
  // (These are NOT needed for Railway standalone deployment)
  const hasOAuthConfig = process.env.OAUTH_SERVER_URL && process.env.VITE_APP_ID;
  if (hasOAuthConfig) {
    try {
      const { registerOAuthRoutes } = await import("./oauth");
      const { appRouter } = await import("../routers");
      const { createContext } = await import("./context");
      const { createExpressMiddleware } = await import("@trpc/server/adapters/express");

      registerOAuthRoutes(app);
      app.use(
        "/api/trpc",
        createExpressMiddleware({
          router: appRouter,
          createContext,
        })
      );
      console.log("[Server] OAuth and tRPC registered (Manus platform mode)");
    } catch (err) {
      console.warn("[Server] OAuth/tRPC setup skipped:", (err as Error).message);
    }
  } else {
    console.log("[Server] Running in standalone mode (no OAuth, no tRPC)");
  }

  // Development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
