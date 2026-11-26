import http from "node:http";
import { env } from "./config/env";
import app from "./app";
import { initializeSocket } from "./sockets/socket";
import { prisma } from "./config/prisma";
import { startSchedulerWorker, stopSchedulerWorker } from "./modules/ai/scheduler.worker";

const server = http.createServer(app);
initializeSocket(server);

server.listen(env.PORT, () => {
  console.log(`India Chat API listening at http://localhost:${env.PORT}`);
  startSchedulerWorker();
});

async function shutdown() {
  console.log("Shutting down...");
  stopSchedulerWorker();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
