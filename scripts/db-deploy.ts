import "dotenv/config";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const url = process.env.DATABASE_URL;
if (!url?.startsWith("file:"))
  throw new Error("此骨架仅支持 SQLite file: 数据库");
const configured = url.slice(5);
if (configured.includes("?"))
  throw new Error("首版 DATABASE_URL 不使用查询参数");
const path = isAbsolute(configured)
  ? configured
  : resolve("apps/api/prisma", configured);
mkdirSync(dirname(path), { recursive: true });
// Prisma 6 on this Windows environment needs the SQLite file to exist first.
// Exclusive creation preserves existing data and makes the first deployment repeatable.
try {
  closeSync(openSync(path, "wx"));
} catch (error: any) {
  if (error.code !== "EEXIST") throw error;
}
execFileSync(
  process.execPath,
  [
    resolve("node_modules/prisma/build/index.js"),
    "migrate",
    "deploy",
    "--schema",
    "apps/api/prisma/schema.prisma",
  ],
  {
    env: {
      ...process.env,
      CHECKPOINT_DISABLE: "1",
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    },
    stdio: "inherit",
    timeout: 60000,
  },
);
