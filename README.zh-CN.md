# 猫砂盆

[English](README.md)

给 [Tailscale Tailcat](https://github.com/tailscale/tailcat) 用的桌面图形界面，支持 macOS 和 Windows。用 [Wails](https://wails.io) v2 写的（Go + React + TypeScript）。

[![CI](https://github.com/mushroom11s/tailcat-desktop-client/actions/workflows/ci.yml/badge.svg)](https://github.com/mushroom11s/tailcat-desktop-client/actions/workflows/ci.yml)

<p align="center">
  <img src="docs/assets/icon.png" alt="猫砂盆" width="256" />
</p>

中文产品名是 **猫砂盆**，英文产品名是 **Tailcat Box**。GitHub 仓库名仍是 `tailcat-desktop-client`。

## 功能

- **连接** — 管道拨号、转发本地 TCP 端口、打开网页、跑 SSH 命令、开 SOCKS 代理
- **服务** — 临时管道、TCP 端口映射、共享目录、带密钥的 SSH、无认证 SSH（要输入 `CONFIRM`）、出口节点、每个连接执行一条命令
- **文件** — 收进文件夹、发给对方、共享目录、列出对方路径
- **密钥和地址** — 命名密钥、解析地址、DERP 区域和地图 URL
- **诊断** — Ping，也可以一直等到直连成功
- **设置** — 跟随系统 / 浅色 / 深色、中英文、客户端和系统信息、开机时启动
- **托盘** — macOS 和 Windows 上可以打开或退出（Linux 用应用菜单）。托盘图标和应用图标是同一只像素猫。关掉窗口只会藏起来，会话继续跑

界面只跟 Go 服务层说话。只有 `internal/adapter` 会导入 `github.com/tailscale/tailcat`（固定在 **v0.7.0**）。

## 环境

| 工具 | 说明 |
| --- | --- |
| **Go 1.27.1+** | `github.com/tailscale/tailcat` v0.7.0 需要这个版本。Wails v2.16 需要 Go 1.25+。本机 Go 更旧时可以用 `GOTOOLCHAIN=auto` 自己拉。 |
| **Node.js 18+** 和 npm | 前端在 `frontend/`，Vite + React + TypeScript。 |
| **Wails CLI v2** | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0` |
| **系统 webview** | macOS 装 Xcode Command Line Tools。Windows 需要 WebView2（现在的系统一般已经有了）。 |

```bash
wails doctor
```

## 开发

在仓库根目录：

```bash
wails dev
```

不想连 DERP 时：

```bash
TAILCAT_ADAPTER=fake wails dev
```

Linux（包括只带 WebKitGTK 4.1 的 Ubuntu 24.04）：

```bash
TAILCAT_ADAPTER=fake wails dev -tags webkit2_41
```

只在 `frontend/` 里跑 `npm run dev` 时没有 Go 绑定。界面会改用浏览器里的模拟适配器，并显示「网页预览（模拟）」。

## 构建

在你要出二进制的系统上：

```bash
wails build
```

产物是 `build/bin/tailcat-box`（macOS 为 `.app`，Windows 为 `.exe`）。正式支持的是 macOS 和 Windows。

Linux 不作为发行目标。Ubuntu 24.04 上装好 `libgtk-3-dev` 和 `libwebkit2gtk-4.1-dev` 后，可以用 `wails build -tags webkit2_41` 自己编。

只编前端：

```bash
cd frontend
npm install
npm run build
```

## 测试

```bash
go test ./...
cd frontend && npm run build
```

`go test ./...` 不包含真实适配器的集成测试。那一项要能访问 Tailcat DERP（HTTPS / UDP），需要时再跑：

```bash
go test -tags=integration ./internal/adapter/ -v -count=1
```

## 模拟适配器和真实适配器

默认走内嵌的 Tailcat 库，用公网 DERP。

| | 真实（默认） | 模拟（`TAILCAT_ADAPTER=fake`） |
| --- | --- | --- |
| 怎么开 | `wails dev` / `wails build` | `TAILCAT_ADAPTER=fake wails dev` |
| 网络 | 公网 DERP | 不联网 |
| 管道 | 得到 `tc…` 地址。连接时拨 TCP **1** 端口（和直接跑 `tailcat <地址>` 一样）。 | 地址是 `tc:fake-<id>`。拨号回复 `echo:<内容>`。 |
| 端口 | 端口服务按映射转发。本地转发和浏览听在 localhost。 | 地址是 `tc:fake-port-<id>`。 |
| 文件 | 接收和共享走 TCP **22** 上的 SFTP。 | 接收、共享、发送、列目录都返回固定的模拟结果。 |
| SSH、SOCKS、出口节点、Exec | SSH 用 **22** 端口。SOCKS 经对方拨出。出口节点和 Exec 用库里的处理函数。 | 固定的 `tc:fake-…` 地址，以及一个本地 SOCKS 地址。 |
| 密钥和 DERP | 解析地址走库。保存的区域和地图 URL 会用到后面的会话。 | 解析得到占位 JSON。补全地址得到 `tc:fake-resolved`。 |
| Ping | Disco ping（先 DERP，能直连再直连）。 | 依次打出 DERP 和直连的事件行。 |

## 配置目录

新安装的密钥和设置写在 `<用户配置目录>/tailcat-box`（密钥是 `keys/` 里的 `*.private.json`）。

| 系统 | 常见路径 |
| --- | --- |
| macOS | `~/Library/Application Support/tailcat-box` |
| Windows | `%AppData%\tailcat-box` |
| Linux | `~/.config/tailcat-box` |

如果以前已经有 `<用户配置目录>/tailcat-desktop-client`，而 `tailcat-box` 还不存在，程序会继续用旧目录。想换到新路径时，把那个文件夹改名为 `tailcat-box` 即可。也可以用 `TAILCAT_KEYS_DIR` 和 `TAILCAT_SETTINGS_DIR` 单独指定目录。

密钥页还会列出 Tailcat 命令行的密钥目录（`~/.config/tailcat/keys`，各系统路径不同），方便把 CLI 的密钥导进来。

## 发布

用 GitHub 自带的 `ubuntu-latest`、`macos-latest`、`windows-latest` 就够，没有用更大的 runner。

| 工作流 | 何时 | 做什么 |
| --- | --- | --- |
| [CI](.github/workflows/ci.yml) | 拉取请求，以及推到 `main` | 在 ubuntu-latest 上跑 `go test ./...`，以及 `frontend` 的 `npm ci` 和 `npm run build` |
| [Release](.github/workflows/release.yml) | 打 `v*` 标签，或手动 **Run workflow** | 在 macOS 和 Windows 上 `wails build`，打包 `build/bin`；真的打了标签才会发 GitHub Release |

发一个版本：

1. 把说明写到 `docs/releases/vX.Y.Z.md`（见[模板](docs/releases/README.md)），合进 `main`。
2. 给这次提交打标签，只推这个标签：

```bash
git checkout main
git pull origin main
git tag v0.1.0
git push origin v0.1.0
```

3. 工作流会编出未签名的 macOS（`.app`）和 Windows（`.exe`）压缩包，名字是 `tailcat-box-macos-…` 和 `tailcat-box-windows-…`，并挂到 GitHub Release 上。如果有 `docs/releases/<标签>.md`，正文用那个文件。

在 **Actions → Release → Run workflow** 里保持勾选 **dry_run**（默认就是勾上的），只会出构建产物，不会发布。确定要发布时再取消勾选，并填一个 `v*` 标签。

现在的 `macos-latest` 是 Apple Silicon。Intel Mac 和 Windows ARM64 还没有编。二进制没有签名（没有 Apple 公证，也没有 Authenticode），所以 Gatekeeper 和 SmartScreen 会警告，这是预期情况。

## 目录

- `main.go` / `app.go` — Wails 入口和给前端调用的方法
- `internal/adapter` — Tailcat 适配器，含模拟和真实两种
- `internal/service` — 会话命令（管道、端口、文件、SSH、SOCKS、出口节点、Exec、Ping）
- `internal/session` — 会话状态
- `internal/store` — 命名密钥和网络设置
- `internal/tray` — 打开、会话数量、退出
- `frontend/` — 连接、服务、文件、密钥、诊断、设置

Go module 路径仍是 `github.com/mushroom11s/tailcat-desktop-client`。

## 致谢

猫砂盆是 [Tailscale Tailcat](https://github.com/tailscale/tailcat) 的桌面客户端。
