import http from "node:http";
import { env } from "./config/env";
import app from "./app";
import { initializeSocket } from "./sockets/socket";
import { prisma } from "./config/prisma";

const server = http.createServer(app);
initializeSocket(server);

server.listen(env.PORT, () => {
  console.log(`India Chat API listening at http://localhost:${env.PORT}`);
});

async function shutdown() {
  console.log("Shutting down...");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
