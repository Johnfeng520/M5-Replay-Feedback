import "dotenv/config";
import { db } from "./db";
import { createApp } from "./app";
const app = await createApp(db);
await app.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3001),
});
console.log("集成平台已启动；构建后可在此端口打开创作与试玩页面。");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
