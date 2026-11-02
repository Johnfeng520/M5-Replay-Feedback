import "dotenv/config";
import { resolve } from "node:path";
import { db } from "../apps/api/src/db";
import { mediaRoot } from "../apps/api/src/infrastructure/assets";
import { backup, restore } from "./backup-lib";
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error("缺少参数 " + name);
  return resolve(process.argv[i + 1]);
};
try {
  if (process.argv.includes("--from")) {
    const result = await restore(arg("--from"), arg("--to"));
    console.log(
      '已恢复到新目录；停止现有服务后运行：npm start -- --env "' +
        result.env +
        '"',
    );
  } else {
    const result = await backup(db, mediaRoot(), arg("--out"));
    console.log(
      "备份完成，固定素材 " +
        result.media.length +
        " 个。备份含用户数据，请按私有文件保管。",
    );
  }
} finally {
  await db.$disconnect();
}
