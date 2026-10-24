# Windows Server 一次部署

适用于当前 `smartsteel.site` 的阿里云 Windows Server：Nginx 已将 `/api/` 转发到 `127.0.0.1:8000`，其余请求转发到 `127.0.0.1:3000`；后端和前端由 `SteelVision Backend`、`SteelVision Frontend` 计划任务启动。

先确认新版源码已经解压到 `C:\steelvision-stage-ff855b2`，并已在新版 `backend\.venv` 中安装 `requirements.txt`。在服务器的**管理员 PowerShell** 中运行：

```powershell
Invoke-WebRequest 'https://raw.githubusercontent.com/CheskPoint/steel-ai-inspection/main/scripts/deploy_windows.ps1' -OutFile "$env:TEMP\deploy_windows.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\deploy_windows.ps1"
```

脚本会检查模型和依赖；缺少 Microsoft VC++ 运行库时，从 Microsoft 下载并验证签名后安装；构建前端并在临时端口测试前后端。通过后，它会隐蔽输入新的管理员初始密码、备份数据和原计划任务、切换启动任务，并检查公开网站。切换失败时会恢复原计划任务。看到 `DEPLOYED` 才代表脚本确认发布成功。

新版解压目录在发布后就是运行目录，**不要删除**。业务数据保存在 `C:\steelvision-data`，备份保存在 `C:\steelvision-backup`。如需回退，运行部署成功时脚本打印的 `ROLLBACK` 命令；回退不会删除新版数据。

若脚本提示需要重启以完成 VC++ 运行库安装，先安排服务器重启，再运行同一命令。脚本在依赖检查失败时不会切换网站。
