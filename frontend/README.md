# CR7 智检 前端

React / Vinext 质检工作台。采用紧凑侧栏、图像卡片、原图叠加复核框和原生 dialog 抽屉；含单图、文件夹、内置/USB 和 RTSP/HTTP 网络摄像头入口。

使用 npm 和 `package-lock.json`；从 GitHub 克隆后运行 `npm.cmd ci`。本机 Sites 配置 `frontend/.openai/hosting.json` 不进入仓库，缺失时自动使用不带项目 ID 的 `hosting.example.json`。仅当前端托管确实需要 Sites 资源绑定时，再在本机创建配置。

```powershell
npm.cmd ci
npm.cmd run dev -- --port 3000
```

后端需运行在同主机名的 8000 端口。默认 API 根据当前浏览器 hostname 生成；如需修改，设置 `NEXT_PUBLIC_API_BASE_URL` 后重启。真实 HttpOnly Cookie 登录，初始 admin/admin123；不再使用 sessionStorage 模拟账号。

## 验证

- `npm test`：生产构建、检测队列/CSV/请求协议、复核坐标/统计筛选、服务端渲染测试。
- `npm run test:browser`：Chrome 浏览器端到端测试。自动启动 3001 前端、8001 临时后端、8002 合成 MJPEG 流，使用真实 best.pt 和独立临时数据库。需要 backend/.venv 依赖可用，测试端口空闲。
- 浏览器测试不访问实体摄像头；本机采集用 canvas.captureStream，网络视频用本地合成流。
- `npx tsc --noEmit`：全项目 TypeScript 检查，包括 Worker 和浏览器测试。
- `npm run lint`：源码 ESLint 检查，忽略构建产物和生成的运行时声明。
- Worker 运行时声明已生成到 `worker-configuration.d.ts`；升级 Wrangler 后可运行 `npx wrangler types worker-configuration.d.ts --config worker/types.wrangler.jsonc --include-env false` 更新。此配置仅用于生成类型。

业务与摄像头图像来自 Cookie 鉴权接口或 Blob URL，使用原生 img，避免图片优化代理丢失用户 Cookie。完整操作见 ../docs/02-快速启动.md。
