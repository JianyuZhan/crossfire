<p align="center">
  <h1 align="center">Crossfire</h1>
  <p align="center">
    <strong>AI 对抗辩论引擎</strong> — 让两个 AI 智能体进行结构化辩论，辅助更优决策。
  </p>
  <p align="center">
    中文&nbsp;&nbsp;|&nbsp;&nbsp;<a href="./README.md">English</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
    <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript">
    <img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js 20+">
  </p>
</p>

---

Crossfire 编排 **提议者 vs. 挑战者** 之间的结构化辩论，支持 **Claude**、**Codex** 和 **Gemini** 智能体的任意组合。它实时追踪立场收敛，可选地调用裁判评估论点质量，并通过终端 UI 实时呈现整个辩论过程。

用它来压力测试方案、探索权衡取舍，或对任何主题生成高质量的分析——一切在终端中完成。

## 目录

- [特性亮点](#特性亮点)
- [快速开始](#快速开始)
- [终端 UI](#终端-ui)
- [CLI 参考](#cli-参考)
- [运行时命令](#运行时命令)
- [支持的智能体](#支持的智能体)
- [配置文件](#配置文件)
- [输出文件](#输出文件)
- [工作原理](#工作原理)
- [架构概览](#架构概览)
- [贡献指南](#贡献指南)

## 特性亮点

- **多模型混战** — 自由组合 Claude（Agent SDK）、Codex（JSON-RPC）、Gemini（子进程）担任任意角色
- **实时终端 UI** — 分屏面板，实时展示思考过程、工具调用、消息流和收敛指标
- **事件溯源** — 所有事件持久化为 JSONL。支持中断恢复、任意速度回放
- **结构化提取** — 智能体通过 tool call 上报立场、置信度、关键论点和让步（Zod 校验）
- **裁判仲裁** — 可选的裁判智能体评分论证、检测停滞、可提前终止辩论
- **有界提示词** — 4 层提示词架构，token 用量跨轮次基本恒定（无 O(n²) 增长）
- **配置文件系统** — YAML frontmatter + Markdown 系统提示词，按角色定制行为、模型和 MCP 服务器

## 前置要求

- **Node.js** 20+
- **pnpm** 9+
- 至少安装一个智能体 CLI：[`claude`](https://docs.anthropic.com/en/docs/claude-code)、[`codex`](https://github.com/openai/codex) 或 [`gemini`](https://github.com/google-gemini/gemini-cli)

## 安装

```bash
git clone https://github.com/jyzhan/crossfire.git
cd crossfire
pnpm install
pnpm build
```

**方式 A：全局命令（推荐）**

```bash
pnpm setup                           # 确保 PNPM_HOME 在 PATH 中（执行后重启终端）
pnpm -C packages/cli link --global   # 全局注册 `crossfire` 命令
crossfire --version                   # 验证
```

> 如果 `pnpm setup` 提示 "already up to date" 但 `crossfire` 仍找不到，需手动将 pnpm 全局目录加入 PATH：
>
> ```bash
> echo 'export PNPM_HOME="$HOME/Library/pnpm"' >> ~/.zshrc  # macOS
> echo 'export PATH="$PNPM_HOME:$PATH"' >> ~/.zshrc
> source ~/.zshrc
> ```

**方式 B：直接运行（无需全局安装）**

```bash
node packages/cli/dist/index.js <command> [options]
```

## 快速开始

```bash
# Claude 对战 Claude（裁判自动推断）
crossfire start \
  --topic "Should we adopt microservices?" \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --max-rounds 5

# 跨模型对战：Claude vs Codex，Gemini 裁判
crossfire start \
  --topic "Is caching always better than recomputing?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --judge gemini/judge

# 从文件读取议题，无裁判
crossfire start \
  --topic-file proposal.md \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --judge none

# 无界面模式（事件仍会持久化）
crossfire start \
  --topic "Quick brainstorm" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --headless -v
```

## 终端 UI

终端 UI 提供实时分屏辩论视图：

```
┌─ StatusBar ──────────────────────────────────────────────────┐
│ Crossfire — Round 3/10 — proposer-turn                       │
├──────────────────────────────┬───────────────────────────────┤
│  Proposer (claude)           │  Challenger (codex)            │
│  ◉ Speaking...               │  ○ Idle                        │
│                              │                               │
│  [thinking...]               │  Last response:               │
│  The key advantage of...     │  While caching improves...    │
│                              │                               │
│  ▸ Read(src/cache.ts) ✓     │                               │
│  ▸ Grep("TTL") running...   │                               │
├──────────────────────────────┴───────────────────────────────┤
│ Round 2/10 │ Conv: [====------] 35% │ P[agree 0.8] ↔        │
│ C[disagree 0.7] d=0.45 │ Judge: P7:C5 │ Tokens: 12.4k      │
├──────────────────────────────────────────────────────────────┤
│ > /                                                          │
└──────────────────────────────────────────────────────────────┘
```

- **智能体面板** — 实时展示思考（灰色）、工具调用和消息输出
- **指标栏** — 收敛进度、立场追踪、裁判评分、token 用量
- **命令输入** — 根据上下文自动切换模式（正常 / 审批 / 回放）

使用 `--headless` 跳过 UI。事件仍会持久化，可随后回放。

## CLI 参考

### `crossfire start`

启动新辩论。

| 选项                          | 说明                                | 默认值                   |
| ----------------------------- | ----------------------------------- | ------------------------ |
| `--topic <text>`              | 辩论主题                            | —                        |
| `--topic-file <path>`         | 从文件读取主题（与 `--topic` 互斥） | —                        |
| `--proposer <profile>`        | 提议者配置文件                      | _必填_                   |
| `--challenger <profile>`      | 挑战者配置文件                      | _必填_                   |
| `--judge <profile\|none>`     | 裁判配置文件，`none` 禁用           | 自动推断                 |
| `--max-rounds <n>`            | 最大轮数                            | `10`                     |
| `--judge-every-n-rounds <n>`  | 裁判评估间隔                        | `3`                      |
| `--convergence-threshold <n>` | 收敛灵敏度 (0–1)                    | `0.3`                    |
| `--model <model>`             | 所有角色的模型覆盖                  | —                        |
| `--proposer-model <model>`    | 提议者模型覆盖                      | —                        |
| `--challenger-model <model>`  | 挑战者模型覆盖                      | —                        |
| `--judge-model <model>`       | 裁判模型覆盖                        | —                        |
| `--output <dir>`              | 输出目录                            | `run_output/debate-<ts>` |
| `--headless`                  | 禁用终端 UI                         | `false`                  |
| `-v, --verbose`               | 详细日志                            | `false`                  |

**模型优先级：** `--proposer-model` > `--model` > 配置文件 `model` 字段 > 模型提供商默认值。

### `crossfire resume <output-dir>`

恢复中断的辩论，从持久化事件重建状态。

| 选项                     | 说明           | 默认值           |
| ------------------------ | -------------- | ---------------- |
| `--proposer <profile>`   | 覆盖提议者配置 | 来自 `meta.json` |
| `--challenger <profile>` | 覆盖挑战者配置 | 来自 `meta.json` |
| `--judge <profile>`      | 覆盖裁判配置   | 来自 `meta.json` |
| `--headless`             | 禁用终端 UI    | `false`          |

### `crossfire replay <output-dir>`

回放已完成的辩论（支持变速）。无需智能体连接。

| 选项               | 说明         | 默认值 |
| ------------------ | ------------ | ------ |
| `--speed <n>`      | 回放速度倍率 | `1`    |
| `--from-round <n>` | 从指定轮开始 | 开头   |

### `crossfire status <output-dir>`

显示辩论状态摘要。加 `--json` 输出机器可读格式。

```
Debate: d-20260321-143022
Topic:  Should we adopt microservices?
Rounds: 8/10
Events: 4523
Duration: 127.3s
Ended:  convergence
Segments: 1
```

## 运行时命令

辩论进行时，在 TUI 输入栏中输入命令：

| 命令                        | 效果                           |
| --------------------------- | ------------------------------ |
| `/pause`                    | 暂停辩论（等当前回合完成）     |
| `/resume`                   | 恢复暂停的辩论                 |
| `/stop`                     | 立即停止                       |
| `/inject proposer <text>`   | 向提议者下一轮注入上下文       |
| `/inject challenger <text>` | 向挑战者下一轮注入上下文       |
| `/inject! proposer <text>`  | 高优先级注入（必须处理的指令） |
| `/inject judge <text>`      | 立即触发裁判并附带用户指令     |
| `/extend <n>`               | 增加 N 轮最大轮数              |

**审批模式**（工具审批请求时自动激活）：`/approve`、`/deny`

**回放模式**：`/speed <n>`、`/pause`、`/resume`、`/jump round <n>`

## 支持的智能体

| 配置文件 `agent` 字段 | CLI 工具 | 传输方式                       |
| --------------------- | -------- | ------------------------------ |
| `claude_code`         | `claude` | 进程内 Agent SDK（异步生成器） |
| `codex`               | `codex`  | 双向 JSON-RPC 2.0 over stdio   |
| `gemini_cli`          | `gemini` | 每轮子进程                     |

任何智能体可以担任任何角色（提议者、挑战者或裁判），自由混搭。

## 配置文件

配置文件使用 YAML frontmatter + Markdown 系统提示词：

```yaml
---
name: my_debater
description: A skilled technical debater
agent: claude_code
model: claude-sonnet-4-20250514
inherit_global_config: true
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-filesystem"]
---
## Your Role

You are a skilled debater. Present clear arguments backed by evidence.
Use the debate_meta tool to report your stance after each response.
```

| 字段                    | 说明                                              | 必填 | 默认值     |
| ----------------------- | ------------------------------------------------- | ---- | ---------- |
| `name`                  | 配置标识符                                        | 是   | —          |
| `description`           | 可读描述                                          | 否   | —          |
| `agent`                 | 智能体类型 (`claude_code`, `codex`, `gemini_cli`) | 是   | —          |
| `model`                 | 首选模型                                          | 否   | 提供商默认 |
| `inherit_global_config` | 合并用户全局 MCP 配置                             | 否   | `true`     |
| `mcp_servers`           | 配置文件专属 MCP 服务器                           | 否   | `{}`       |

**搜索路径：** `./profiles/` → `~/.config/crossfire/profiles/`

**裁判自动推断：** 未指定 `--judge` 时，Crossfire 自动选择与提议者适配器类型匹配的裁判配置（如 `claude/proposer` 默认使用 `claude/judge`）。用 `--judge none` 禁用裁判。

内置配置文件：

```
profiles/
├── claude/    # proposer.md, challenger.md, judge.md
├── codex/     # proposer.md, challenger.md, judge.md
└── gemini/    # proposer.md, challenger.md, judge.md
```

## 输出文件

每次辩论在输出目录下产生以下文件：

| 文件            | 说明                                        |
| --------------- | ------------------------------------------- |
| `events.jsonl`  | 完整事件日志（每行一条 JSON）— 唯一事实来源 |
| `index.json`    | 元数据、字节偏移、段清单                    |
| `meta.json`     | 辩论配置、配置文件映射、版本信息            |
| `transcript.md` | 人类可读的 Markdown 辩论记录                |

恢复时会创建新的段文件（如 `events-resumed-<ts>.jsonl`），并在 `index.json` 中追踪。

## 工作原理

1. **加载配置** — CLI 读取 YAML 配置文件，用 Zod 校验，将 `agent` 字段映射到适配器类型。

2. **创建适配器** — 每个角色获得一个 `AgentAdapter` 实例，将三种协议（SDK、JSON-RPC、子进程）统一为 `NormalizedEvent` 事件流（16 种事件）。

3. **事件总线** — 所有事件流经 `DebateEventBus`。TUI、EventStore（JSONL 持久化）和 TranscriptWriter 均订阅此总线。

4. **回合循环** — 编排器从投影状态构建提示词 → 发送给智能体 → 等待 `turn.completed` → 另一方重复。每次决策前都从事件重新投影状态（纯事件溯源）。

5. **结构化提取** — 智能体调用 `debate_meta` 上报立场（5 级量表）、置信度、关键论点和让步。裁判调用 `judge_verdict` 给出评分和继续/停止建议。

6. **有界提示词** — 4 层提示词架构（稳定前缀、长期记忆、局部窗口、回合指令）让 token 用量跨轮次基本恒定。

7. **收敛检测** — 基于立场差值 + 双方让步 + 双方希望结束意愿计算。收敛百分比超过阈值时辩论提前结束。

8. **持久化** — 事件每 100ms 批量写入 JSONL（回合/辩论结束时同步写入）。完整事件日志支持确定性回放和恢复。

完整架构参考（含类型定义、接口和数据流图）请见 **[docs/architecture.md](docs/architecture.md)**。

> **注意：** `docs/architecture.md` 是综合设计参考文档，但可能与源码不完全同步。有疑问时以源码为准。

## 架构概览

```
packages/
├── adapter-core/        # NormalizedEvent（16 种）、AgentAdapter 接口、Zod schema、契约测试
├── adapter-claude/      # Claude Agent SDK 适配器（进程内异步生成器）
├── adapter-codex/       # Codex JSON-RPC 2.0 双向 stdio 适配器
├── adapter-gemini/      # Gemini 子进程适配器（A→B 降级）
├── orchestrator-core/   # 纯逻辑：状态投影、收敛、上下文构建器、辩论记忆、导演
├── orchestrator/        # 副作用：辩论运行器、DebateEventBus、EventStore（JSONL）、TranscriptWriter
├── tui/                 # Ink（CLI 的 React）组件、TuiStore、EventSource/PlaybackClock
└── cli/                 # Commander.js 入口、YAML 配置系统、组装工厂
```

**核心设计原则：**

- **事件溯源** — 所有状态 = `projectState(events[])`。纯 reducer，确定性回放。
- **纯核心 / 副作用外壳** — `-core` 包零 I/O 依赖。
- **能力门控适配器** — `approve?`/`interrupt?` 不支持时为 `undefined`，而非空操作。
- **有界会话记忆** — 4 层提示词结构，从 `DebateState` 提取数据，而非原始对话记录。

## 贡献指南

欢迎贡献！详见 **[CONTRIBUTING.md](CONTRIBUTING.md)**（英文），涵盖开发环境搭建、技术栈、测试说明、项目规范及新适配器开发指南。

## 许可证

MIT

## 致谢

基于 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)、[Codex CLI](https://github.com/openai/codex)、[Gemini CLI](https://github.com/google-gemini/gemini-cli)、[Ink](https://github.com/vadimdemedes/ink) 和 [Zod](https://github.com/colinhacks/zod) 构建。
