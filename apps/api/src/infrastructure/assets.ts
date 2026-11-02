import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { Story, Asset } from "@campus/contracts";
import { ensure } from "./core";
export const repoRoot = resolve(import.meta.dirname, "../../../..");
export const mediaRoot = () =>
  resolve(process.env.MEDIA_ROOT ?? resolve(repoRoot, "data/media"));
export async function assetCatalog(): Promise<Asset[]> {
  const catalog = JSON.parse(
    await readFile(resolve(repoRoot, "fixtures/assets/catalog.json"), "utf8"),
  );
  ensure(
    catalog.catalogVersion === "1.0" && Array.isArray(catalog.assets),
    422,
    "ASSET_INVALID",
    "素材目录格式不受支持",
  );
  return catalog.assets;
}
export async function captureAssets(
  story: Story,
  options: {
    catalog?: Asset[];
    publicRoot?: string;
    storageRoot?: string;
  } = {},
): Promise<Asset[]> {
  const ids = [
    ...new Set(
      story.nodes
        .flatMap((n) => [n.media.backgroundId, n.media.audioId])
        .filter(Boolean),
    ),
  ] as string[];
  if (!ids.length) return [];
  const catalog = options.catalog ?? (await assetCatalog()),
    result: Asset[] = [];
  const configuredRoot =
    options.publicRoot ?? resolve(repoRoot, "apps/web/public");
  const publicRoot = await realpath(configuredRoot).catch(() =>
    resolve(configuredRoot),
  );
  const storage = options.storageRoot ?? mediaRoot();
  for (const id of ids) {
    const a = catalog.find((a) => a.id === id);
    ensure(a, 422, "ASSET_INVALID", "素材不存在：" + id);
    ensure(
      story.nodes.every(
        (n) =>
          (n.media.backgroundId !== id || a.kind === "background") &&
          (n.media.audioId !== id || a.kind === "audio"),
      ),
      422,
      "ASSET_INVALID",
      "素材类型与引用位置不符",
    );
    const source = resolve(publicRoot, a.path.replace(/^\/+/, ""));
    const sourceReal = await realpath(source).catch(() => "");
    ensure(
      sourceReal.startsWith(publicRoot + sep),
      422,
      "ASSET_INVALID",
      "素材路径不存在或不合法",
    );
    const data = await readFile(sourceReal);
    const hash = createHash("sha256").update(data).digest("hex");
    ensure(
      a.contentHash === hash,
      422,
      "ASSET_INVALID",
      "素材内容校验失败：" + id,
    );
    await mkdir(storage, { recursive: true });
    const dest = resolve(storage, hash);
    try {
      await writeFile(dest, data, { flag: "wx" });
    } catch (e) {
      if ((e as any).code !== "EEXIST") throw e;
    }
    ensure(
      createHash("sha256")
        .update(await readFile(dest))
        .digest("hex") === hash,
      422,
      "ASSET_INVALID",
      "固定素材副本校验失败",
    );
    result.push({ ...a, path: "/api/v1/media/" + hash });
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
