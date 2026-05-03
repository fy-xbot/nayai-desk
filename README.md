# NayAI Desk

多模型 AI 聚合工作台。在一个桌面窗口中并排打开多个 AI 聊天界面，统一输入、广播提问，并通过 AI 裁判对比回答质量。

## 功能特性

**多模型工作区** -- 最多同时展示 6 个 AI 面板，支持列布局、行布局、网格布局。

**统一输入广播** -- 输入一次，同时发送到所有面板。支持文本和图片。

**AI 评分** -- 配置一个裁判模型（DeepSeek / OpenAI / Anthropic / 自定义接口），对每个回答打分 0-10 并叠加显示在对话中。

**离线语音输入** -- 通过 whisper.cpp 本地转录麦克风语音，首次使用自动下载模型。

**会话管理** -- 创建、切换、持久化对话记录，支持跨面板会话追踪。

**网页精简** -- 注入 CSS/JS 隐藏各平台原生顶栏和输入区域，获得更干净的工作空间。

**支持平台：**

| 地区 | 平台 |
|------|------|
| 国际 | ChatGPT, Google Gemini, Anthropic Claude, Perplexity, xAI Grok |
| 国内 | DeepSeek, 豆包, Kimi, 通义千问, 文心一言 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, Vite 7, Tailwind CSS 4, Zustand 5 |
| 后端 | Tauri 2 (Rust), whisper-rs, reqwest, tokio |
| 平台 | macOS, Windows, Linux（实验性 iOS/Android） |

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) 最新稳定版
- [Tauri CLI](https://tauri.app/start/prerequisites/) -- 需安装平台对应系统依赖

### 开发

```bash
npm install
npm run tauri dev
```

### 构建

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`。

## 项目结构

```
src/
  components/         # UI 组件（侧栏、工作区、设置等）
  providers/          # 平台注册表、注入脚本、URL 规则
  services/           # Webview 管理、AI 评分、语音转录
  stores/             # Zustand 状态管理
  hooks/              # 自定义 Hooks
  types/              # TypeScript 类型定义
src-tauri/
  src/                # Rust 后端（语音、下载、Webview 命令）
  tauri.conf.json     # Tauri 配置
```

## 核心架构

整体架构为 **React 壳 UI + Tauri 多子 Webview + Rust 原生命令桥接**。

**React 壳层** -- 负责侧栏、标签页、输入框、设置面板和布局状态，不承载 AI 页面内容。

**独立 Webview** -- 每个 AI 平台运行在独立的 Tauri Webview 中，彼此隔离，保留原始网页交互。

**Rust 命令层** -- 暴露创建/移动/缩放/注入脚本等原生命令，前端通过 `@tauri-apps/api` 调用。

**状态管理** -- Zustand 按职责拆分：
- `panelStore` -- 面板列表、焦点、Webview 生命周期
- `conversationStore` -- 对话列表、当前会话
- `uiStore` -- 布局模式、侧栏、缩放等 UI 状态
- `scoreStore` -- AI 评分配置与结果
- `whisperStore` -- 语音转录状态

## iOS 开发

```bash
npx tauri ios init
npx tauri ios dev "iPhone 17 Pro"
```

## License

MIT
