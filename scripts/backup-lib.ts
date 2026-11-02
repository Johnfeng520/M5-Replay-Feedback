import { PrismaClient } from "@prisma/client";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
type Manifest = {
  format: 1;
  createdAt: string;
  database: { file: string; sha256: string };
  media: { file: string; sha256: string }[];
};
const hash = async (p: string) =>
  createHash("sha256")
    .update(await readFile(p))
    .digest("hex");
async function fresh(p: string) {
  // Exclusive directory creation: never merge into, delete or overwrite an existing directory.
  await mkdir(p, { recursive: false });
}
export async function backup(
  db: PrismaClient,
  mediaRoot: string,
  destination: string,
) {
  destination = resolve(destination);
  await fresh(destination);
  const dbPath = join(destination, "snapshot.db");
  // SQLite supplies a consistent database snapshot. Immutable media is copied afterwards.
  await db.$executeRawUnsafe(`VACUUM INTO '${dbPath.replaceAll("'", "''")}'`);
  const media: { file: string; sha256: string }[] = [];
  const needed = new Set<string>();
  const snapshot = new PrismaClient({
    datasourceUrl: "file:" + dbPath.replaceAll("\\", "/"),
  });
  try {
    for (const version of await snapshot.publishedVersion.findMany())
      for (const asset of version.assets as any[])
        needed.add(asset.contentHash);
  } finally {
    await snapshot.$disconnect();
  }
  await mkdir(join(destination, "media"));
  for (const id of [...needed].sort()) {
    if (!/^[a-f0-9]{64}$/.test(id) || (await hash(join(mediaRoot, id))) !== id)
      throw new Error("固定素材不存在或摘要不一致：" + id);
    await copyFile(join(mediaRoot, id), join(destination, "media", id));
    media.push({ file: id, sha256: id });
  }
  const manifest: Manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    database: { file: "snapshot.db", sha256: await hash(dbPath) },
    media,
  };
  // Manifest is the completion marker; a failed backup without this file is not restorable.
  await writeFile(
    join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx" },
  );
  return manifest;
}
export async function restore(source: string, destination: string) {
  source = resolve(source);
  destination = resolve(destination);
  const manifest: Manifest = JSON.parse(
    await readFile(join(source, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    manifest.database?.file !== "snapshot.db" ||
    !Array.isArray(manifest.media)
  )
    throw new Error("备份格式不受支持");
  if ((await hash(join(source, "snapshot.db"))) !== manifest.database.sha256)
    throw new Error("数据库备份校验失败");
  for (const m of manifest.media) {
    if (
      !/^[a-f0-9]{64}$/.test(m.file) ||
      m.sha256 !== m.file ||
      (await hash(join(source, "media", m.file))) !== m.sha256
    )
      throw new Error("素材备份校验失败");
  }
  await fresh(destination);
  await mkdir(join(destination, "media"));
  await copyFile(join(source, "snapshot.db"), join(destination, "restored.db"));
  for (const m of manifest.media)
    await copyFile(
      join(source, "media", m.file),
      join(destination, "media", m.file),
    );
  const env = `DATABASE_URL=${JSON.stringify("file:" + join(destination, "restored.db").replaceAll("\\", "/"))}\nMEDIA_ROOT=${JSON.stringify(join(destination, "media").replaceAll("\\", "/"))}\nHOST=127.0.0.1\nPORT=3001\nWEB_ORIGIN=http://localhost:3001\n`;
  await writeFile(join(destination, "restore.env"), env, { flag: "wx" });
  return {
    database: join(destination, "restored.db"),
    env: join(destination, "restore.env"),
  };
}
