# 备份/恢复命令验证

2026-11-02，本机演示数据库执行成功：

```powershell
npm run backup -- --out .local/cli-backup-20261102
npm run restore -- --from .local/cli-backup-20261102 --to .local/cli-restore-20261102
```

两个命令退出码均为0；真实演示内容的备份manifest生成，restore.env写入新目录。自动化另对新库读取、恢复续玩、事件关联、固定素材哈希、篡改备份及非覆盖行为做断言。运行库、备份数据和restore.env不随包分发。
