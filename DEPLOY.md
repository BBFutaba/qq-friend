# QQ 群友 · 部署指南

这份指南写给两类读者：自己动手的人，以及帮你部署的 AI agent（Claude Code、Codex 等）。如果你用 agent，把项目文件夹交给它，对它说：

```text
请按 DEPLOY.md 帮我部署 QQ 群友。遇到需要我操作或提供信息的步骤就停下来问我。
```

整个部署只在你自己的电脑上进行，大约 20–40 分钟，主要时间花在登录 QQ 和模型账号上。

---

## 0. 给 agent 的硬性规则

部署过程中必须遵守以下规则，用户另行明确要求时除外：

1. **不发送任何 QQ 消息。** 不调用 `send_group_msg` / `send_private_msg`，不点击、也不请求「启动群友」，不关闭调试模式。第 8 步的首次试运行由用户自己决定、自己点击。
2. **不泄露凭据。** `data/` 里的任何内容都不能复述、打印或上传，包括 `connections.json`、`admin-token.txt` 和数据库；OneBot Token 和管理密钥也不要写进回复。脚本的输出本来就不含令牌。
3. **需要用户本人完成的事要停下来问**：扫码登录 QQ、登录 ChatGPT / Claude 账号、提供机器人 QQ 号、提供用户自己的 QQ 号和群号、写人格设定。
4. **不要修改 `src/` 里的安全限制**（白名单、只连本机、禁用工具、审批绑定等），也不要关掉测试。
5. 每完成一步，用本指南给出的命令验证，再继续下一步。最终以 `node scripts/doctor.js` 输出 `"passed": true` 作为部署完成的标准。
6. 所有命令都在**项目根目录**（包含 `package.json` 的文件夹）里，用 PowerShell 运行。
7. **启动服务只能用 `.\start.ps1 -NoBrowser` 或 `启动QQ群友.cmd`，不要用 `npm start`、`node src/server.js` 或 `Start-Process node`。** agent 的终端通常运行在一个 Windows 作业对象（job object）里，会话结束时，从里面启动的所有进程都会被一起结束，机器人会悄悄下线。`start.ps1` 通过 WMI 启动服务，服务不属于你的终端，会话结束后照常运行。OneBot 实现（如 SnowLuma）如果由你启动，也要用同样的方式：`Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '<启动命令>'; CurrentDirectory = '<所在目录>' }`。

---

## 1. 安装基础环境

| 软件 | 必需 | 检查命令 | 安装 |
|---|---|---|---|
| Node.js 24 或更新 | 是 | `node -v` 输出 `v24.x` 或更高 | `winget install OpenJS.NodeJS`，或从 nodejs.org 下载 |
| 电脑版 QQ（QQ NT） | 是 | — | 从 im.qq.com 下载 |
| Python 3.11+（推荐 3.13） | 否，只有媒体理解需要 | `py -3.13 --version` | `winget install Python.Python.3.13` |

装完 Node.js 后，要**重新打开**一个 PowerShell 窗口，`node` 命令才能用。

## 2. 解压并安装依赖

把发行包解压到任意文件夹，路径里可以有中文；最好别放在 OneDrive 等同步盘里。然后在该文件夹里运行：

```powershell
npm ci
npm test
node scripts/setup.js
```

- `npm test` 应显示全部测试通过（`fail 0`）。测试只用内存数据库，不连接 QQ。
- `setup.js` 会创建 `data/` 文件夹，生成管理密钥（`data/admin-token.txt`）和本地连接配置，并尝试为媒体功能创建 Python 环境。它会输出一段 JSON，其中 `notes` 列出还缺什么。现在提示 OneBot、Claude 没配置都是正常的，后面的步骤会补上。

## 3. 准备机器人 QQ 和 OneBot

机器人需要一个**登录在这台电脑上的 QQ 号**（建议用小号），再加上一个 OneBot 11 实现，把这个 QQ 变成程序能调用的接口。常见的实现有 NapCat、LLOneBot、SnowLuma，任选一个，按它自己的文档安装。

在 OneBot 实现里登录机器人 QQ（通常要用手机扫码，**这一步需要用户本人完成**），然后新建两个网络配置：

| 配置 | 类型 | 地址 | 端口（示例） | Token |
|---|---|---|---|---|
| HTTP API | HTTP 服务端（HTTP Server） | `127.0.0.1` | `3000` | 自己设一个长随机字符串 |
| 事件推送 | 正向 WebSocket 服务端（WebSocket Server） | `127.0.0.1` | `3001` | 可以和上面相同 |

要求：

- 地址只能是 `127.0.0.1` 或 `localhost`。本应用会拒绝其他地址，避免接口暴露到网络上。
- 必须设置 Token，HTTP 和 WebSocket 都要。
- 保持心跳开启（大多数实现默认开启）。90 秒收不到任何事件，应用会判定连接断开并重连。
- 消息格式选 `array` 或 `string` 都可以。

记下这两个地址和 Token，第 5 步要用。完成后可以先用浏览器访问 `http://127.0.0.1:3000/get_login_info` 做个粗略检查：返回 401 或要求 Token 是正常的，说明 HTTP 服务已经在运行。

## 4. 准备至少一个模型后端

本地模式直接使用电脑上已登录的模型客户端，并忽略环境变量里的 API Key。也可在后台「Claude API」中填写专用 API 地址和密钥，再将所需 Claude 人格或后台角色切为 API；参见 [README 的 API 说明](README.md#claude-api-与提示词编排)。未选择 API 时，至少需要下面 A 或 B 中的一个。

### A. GPT：Codex CLI（推荐，默认的后台 agent 用它）

```powershell
npm install -g @openai/codex
codex login
```

`codex login` 会打开浏览器，**用户需要用 ChatGPT 账号登录**。已经装了 Codex 桌面版也可以，应用会自动找到它自带的 codex。

### B. Claude：Claude Code + Claude Agent SDK

```powershell
npm install -g @anthropic-ai/claude-code
claude
```

在 `claude` 里按提示登录（**需要用户本人完成**），登录后输入 `/exit` 退出。然后把 SDK 安装到项目的私有目录，再重新运行 setup：

```powershell
npm install --prefix workspace/claude-sdk @anthropic-ai/claude-agent-sdk
node scripts/setup.js
```

这次 setup 的输出里应该有 `"claudeSdkFound": true`。

**如果只装了 B**：部署完成后，到后台「人格与模型 → 后台 agent」把观察、记忆、审核、发现四个角色都改成 Claude 并保存，否则后台 agent 仍会去找 Codex。

### C. DeepSeek（可选）

选择 DeepSeek 人格或后台 agent 时需要它。后台四个角色均可单独选择 DeepSeek；用它做观察员时，图片 / 视频预读仍需要 Codex 的 GPT 6.1 Sol / low。安装 DeepSeek Harness 桌面版后重新运行 `node scripts/setup.js`；如果装在非默认位置，先设置 `$env:DEEPSEEK_HARNESS_CMD` 为 `dsh.cmd` 的完整路径。

## 5. 填写连接、账号和群

需要向用户确认三件事：**机器人 QQ 号**、**用户自己的 QQ 号**（作为审批 QQ，接收调试回复和审批消息），以及**要启用的群号**。如果想让别人也能私聊机器人，再问白名单里要加谁。

下面两种方式选一种即可。

### 方式一：命令行（适合 agent）

服务**没有运行**时执行（`configure.js` 检测到服务正在运行会拒绝写入）：

```powershell
$env:ONEBOT_HTTP_URL = 'http://127.0.0.1:3000'
$env:ONEBOT_WS_URL   = 'ws://127.0.0.1:3001'
$env:ONEBOT_TOKEN    = '<用户提供的 Token>'
node scripts/setup.js
node scripts/configure.js --bot <机器人QQ> --owner <用户自己的QQ> --group <群号>:<群名称>
```

- 有多个群就重复写 `--group`；私聊白名单用 `--allow <QQ>` 添加（审批 QQ 会自动加入）。
- `--persona claude` 让这次新加的群使用 Claude 人格，默认是 `gpt`。
- `node scripts/configure.js --show` 可以查看当前设置。
- 设置完可以关掉这个 PowerShell 窗口，Token 已经保存在 `data/connections.json` 里。

### 方式二：后台网页

1. 双击 **启动QQ群友.cmd**，浏览器会打开 `http://127.0.0.1:4891` 并自动登录。
2. 进入「连接与环境」：
   - 在「OneBot 11 连接」里填写 HTTP 地址、WebSocket 地址和两个 Token，点「保存并重连」。
   - 在「QQ 账号、白名单与群聊」里点「检测 OneBot 登录的 QQ」，机器人 QQ 会自动填好；再填审批 QQ，点「从 QQ 读取群列表」添加群，最后点「保存账号与群聊」。

## 6. 启动服务

用户自己启动：双击 **启动QQ群友.cmd**，服务在后台运行（没有窗口），浏览器会自动打开后台并登录。

agent 启动（不弹出浏览器）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -NoBrowser
```

成功时输出「QQ群友 正在运行：http://127.0.0.1:4891（v版本号）」。服务已经在运行时，它不会重复启动。

- 健康检查：`Invoke-RestMethod http://127.0.0.1:4891/healthz` 应返回 `ok: True`、`app: qq-friend`。
- 日志：`data/server.stdout.log`、`data/server.stderr.log`。
- 停止：双击 **停止QQ群友.cmd**。
- 调试时想在前台运行、直接看到日志，可以用 `npm start`，按 Ctrl+C 停止。这种方式启动的服务会随窗口或 agent 会话一起结束，不要用来正式运行。

刚启动时应用处于**暂停**状态并开启**调试模式**，不会回复任何人。

## 7. 验证

```powershell
node scripts/doctor.js
```

输出是 JSON：`checks` 里每一项都有 `ok`，失败的项附带 `fix` 提示。`required: true` 的项必须全部通过，`"passed": true` 才表示部署完成。各项的意思：

| 检查 | 含义 |
|---|---|
| `node` / `dependencies` | Node 版本、`npm ci` 是否完成 |
| `onebot-settings` / `onebot-login` | OneBot 地址和 Token 已填写，并且能读到登录的 QQ |
| `identity` / `bot-qq-matches` | 机器人 QQ、审批 QQ、启用群已设置，并且机器人 QQ 和 OneBot 实际登录的账号一致 |
| `background-models` | 后台 agent 使用的后端可用 |
| `personas` | 每个启用群使用的人格都有设定，且后端可用（第 8 步才会通过） |
| `codex` / `claude` / `deepseek` / `media` | 各后端和媒体环境是否可用（可选项） |

服务运行时，还可以做两项真实但只读的检查：

```powershell
node scripts/verify-onebot.js    # 确认登录账号，并读取每个启用群的成员列表（不发消息）
node scripts/probe-models.js gpt # 向 GPT 人格发一个极短的测试请求（会计入模型用量）
```

`probe-models.js` 后面写人格名：`gpt`、`claude`、`deepseek`，只测已经装好的后端。

## 8. 写人格并首次试运行（由用户决定）

到这一步，agent 的工作就完成了。接下来请用户自己操作：

1. 在「人格与模型」里点「检测可用模型」，选择模型和推理强度，**写好人格设定**（角色、语气、说话习惯、示例），然后保存。
2. 回到「总览」，首次设置清单应该全部打勾。
3. 保持调试模式，点右上角「启动群友」。用**另一个 QQ 号**在群里说句话。机器人的回复会发到**审批 QQ 的私聊**，开头带有 `[调试 · 群名 · 人格名]`，不会发进群里。
4. 满意之后，到「消息与调试」取消勾选「调试模式」并保存。从这时起，回复会真正发到群里。

## 9. 可选功能

- **图片 / 语音 / 视频理解**：`node scripts/setup.js --media`。需要 Python 3.11+，会下载约几百 MB 的依赖和 Whisper 模型。
- **哔哩哔哩 / X 话题发现**：见 README 的「Chrome 中的哔哩哔哩 / X」。
- **主动话题**：在「主动话题」页面开启。每个候选都要经过 agent 审核，再由你在私聊里回复「批准 编号」后才会发出。

## 10. 日常维护

- **更新版本**：先停止服务，用新版本的文件覆盖除 `data/` 和 `workspace/` 以外的所有内容，再运行 `npm ci`、`node scripts/setup.js`，然后启动。
- **备份**：先停止服务，复制整个 `data` 文件夹。
- **换机器人 QQ 或群**：后台「连接与环境」，或停止服务后运行 `configure.js`。
- **卸载**：停止服务后删除整个项目文件夹。OneBot 实现和模型客户端需要另外卸载。

## 11. 故障排查

| 现象 | 处理 |
|---|---|
| `node` 不是内部或外部命令 | 安装 Node 24 后重新打开 PowerShell |
| `npm ci` 报错 | 确认是在项目根目录运行、网络正常；仍不行就删掉 `node_modules` 再试 |
| 后台显示「请配置 OneBot HTTP 和事件 WebSocket」 | 第 5 步还没完成 |
| 「OneBot 当前登录 QQ xxx，与配置的机器人 QQ 不一致」 | 把机器人 QQ 改成提示里的号，或在 OneBot 里登录配置的那个号 |
| 「OneBot 必须使用本机地址」 | OneBot 地址只能用 `127.0.0.1` / `localhost`，Token 不能写在 URL 里 |
| 连接状态反复断开 | 确认 OneBot 的 WebSocket 服务已开启、心跳已开启、Token 一致；QQ 掉线时需要重新登录 |
| 「需要本地 Codex 的 ChatGPT 登录」 | 运行 `codex login`，用 ChatGPT 账号登录 |
| 「尚未配置本地 Claude Agent SDK」 | 按第 4 步 B 安装 SDK，再运行 `node scripts/setup.js` |
| 「本地 Codex 未提供 xxx / medium」 | 到「人格与模型」点「检测可用模型」，重新选择模型后保存 |
| 启动时提示「请先在「连接与环境」填写…」 | 机器人 QQ、审批 QQ 或启用群还没设置 |
| 启动时提示「人格设定尚未填写」 | 第 8 步：给启用群使用的人格写设定 |
| 群里有人说话但机器人不回 | 先看是否还在调试模式（回复在你的私聊里）；再看「用量」页有没有失败的调用，以及「消息与调试」里的发送记录 |
| 4891 端口被占用 | 先运行「停止QQ群友.cmd」；仍被占用就是别的程序在用这个端口，前台运行可以用 `$env:PORT=4895; npm start` |
| 服务没有启动 | 查看 `data/server.stderr.log` |

## 12. 安全说明

- 后台只监听本机 `127.0.0.1`，必须用管理密钥登录；同一局域网里的其他电脑访问不到。
- QQ 消息、网页、记忆和画像都被当作不可信资料，不能改变权限、人格、模型、收件人或审批规则。
- 模型会话禁用了所有工具（shell、文件、MCP、联网搜索）；一旦检测到工具调用，就立即中止这一轮。
- 私聊只处理白名单里的人，其余私聊在存储和调用模型之前就被丢弃。
- 发送结果不明时不会自动重试；回执不明的消息会在「消息与调试」里标为「结果未知」。
