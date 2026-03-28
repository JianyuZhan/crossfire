<p align="center">
  <img src="assets/logo.png" alt="Crossfire Logo" width="600">
  <h1 align="center">Crossfire</h1>
  <p align="center">
    <strong>面向可执行决策支持的多智能体辩论 CLI</strong> — 用结构化 AI 辩论生成行动计划、权衡取舍与风险清单。
  </p>
  <p align="center">
    中文&nbsp;&nbsp;|&nbsp;&nbsp;<a href="./README.md">English</a>
  </p>
  <p align="center">
    <a href="https://github.com/JianyuZhan/crossfire/actions/workflows/ci.yml"><img src="https://github.com/JianyuZhan/crossfire/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
    <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript">
    <img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js 20+">
  </p>
</p>

---

Crossfire 是一个终端优先的**多智能体辩论编排器**，用于做决策支持。它运行 **提议者 vs. 挑战者** 的结构化辩论，支持 **Claude**、**Codex** 和 **Gemini** 的任意组合，并在辩论结束后综合生成 Markdown 和 HTML 格式的优先级行动计划。

你可以用它来压力测试架构方案、迁移计划、产品判断和事故应对。辩论只是手段；真正的主产物是最终行动计划，以及可追溯的 transcript 和事件日志。

## 目录

- [特性亮点](#特性亮点)
- [适用场景](#适用场景)
- [你将得到什么](#你将得到什么)
- [快速开始](#快速开始)
- [终端 UI](#终端-ui)
- [CLI 参考](#cli-参考)
- [运行时命令](#运行时命令)
- [支持的智能体](#支持的智能体)
- [配置文件](#配置文件)
- [输出文件](#输出文件)
- [工作原理](#工作原理)
- [系统模型](#系统模型)
- [架构概览](#架构概览)
- [当前限制](#当前限制)
- [扩展 Crossfire](#扩展-crossfire)
- [贡献指南](#贡献指南)

## 特性亮点

- **行动计划优先** — 主产物是 `action-plan.html` / `action-plan.md`，而不只是辩论记录
- **多模型混战** — 自由组合 Claude（Agent SDK）、Codex（JSON-RPC）、Gemini（子进程）担任任意角色
- **实时终端 UI** — 分屏面板，实时展示消息流、保留思考摘要、计划/子代理活动、工具调用和收敛指标
- **事件溯源** — 所有事件持久化为 JSONL。支持中断恢复，并可从同一事实来源回放已完成辩论
- **结构化提取** — 智能体通过 tool call 上报立场、置信度、关键论点和让步（Zod 校验）
- **裁判仲裁** — 可选的裁判智能体评分论证、检测停滞、可提前终止辩论，并优先评估证据责任而不是奖励无依据断言
- **自适应最终综合** — 辩论结束后在独立综合会话中生成最终行动计划，模型综合失败时仍有本地回退
- **增量提示词** — 第 1 轮发送完整上下文，第 2 轮起仅发送对手/裁判的新消息，利用提供商会话记忆实现每轮 ~O(1) token 开销
- **配置文件系统** — YAML frontmatter + Markdown 系统提示词，内置 proposer/challenger/judge 配置包含按角色定制的 research 与证据处理约束

## 适用场景

- **架构评审** — 压力测试设计提案、权衡点和迁移路径
- **产品决策** — 在做路线图或重大判断前暴露隐藏假设
- **风险发现** — 强制产出让步、反论点和未解决问题
- **研究综合** — 在一个终端工作流里把对立观点收敛成结构化行动计划

## 你将得到什么

- **实时辩论界面** — 全屏终端 UI，按轮次展示推理过程、保留思考摘要、计划/子代理活动、裁判反馈和收敛进度
- **行动计划输出** — Markdown 和 HTML 两种格式的最终报告，便于分享、编辑和自动化处理
- **完整 transcript** — Markdown 和 HTML 两种格式的人类可读辩论记录
- **可回放审计轨迹** — 事件溯源 JSONL 日志与 `index.json` 元数据，支持回放、恢复和状态查看

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
crossfire --version                  # 验证
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

第一次运行前，请确认你将要使用的 profile 对应的 agent CLI 已经安装、完成认证，并且能在当前 shell 中正常执行。

```bash
# Claude 对战 Claude（裁判自动推断）
crossfire start \
  --topic "Should we adopt microservices?" \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --max-rounds 5 \
  --output run_output/microservices

# 跨模型对战：Claude vs Codex，Gemini 裁判
crossfire start \
  --topic "Is caching always better than recomputing?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --judge gemini/judge

# 无界面模式（完成信息仍输出到 stdout）
crossfire start \
  --topic "Quick brainstorm" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --headless -v
```

上面的示例之所以输出到 `run_output/microservices/`，是因为显式传入了 `--output run_output/microservices`。如果省略 `--output`，Crossfire 会写入默认目录 `run_output/debate-<ts>/`。随后优先查看其中的 `action-plan.html` 或 `action-plan.md`，也可以用 `crossfire status <output-dir>` 查看摘要，或用 `crossfire replay <output-dir>` 回放事件日志。

## 终端 UI

终端 UI 是基于 Ink（CLI 的 React）的全屏应用，由四个垂直区域组成：

- **顶部栏** — 居中品牌标识、辩论 ID、轮次/阶段、提议者与挑战者的智能体信息、辩论主题
- **可滚动内容区** — 按轮次展示智能体消息、思考过程和工具调用。支持方向键、`Ctrl+U`/`Ctrl+D`、`Home`/`End` 滚动
- **指标栏** — 各智能体 token 用量与费用、收敛进度条与百分比、裁判判定、滚动状态（LIVE / SCROLLED）。用量统计会按 provider 语义做归一化，因此部分 provider 的累计值会先转换为增量再显示
- **命令输入** — 实时辩论中根据上下文切换提示符（`>`、`approval>`），用于运行时命令

使用 `--headless` 可跳过 UI。事件和综合输出仍会落盘，之后可以回放或审阅。

## CLI 参考

### `crossfire start`

启动新辩论。

| 选项                          | 说明                                | 默认值                   |
| ----------------------------- | ----------------------------------- | ------------------------ |
| `--topic <text>`              | 辩论主题                            | —                        |
| `--topic-file <path>`         | 从文件读取主题（与 `--topic` 互斥） | —                        |
| `--proposer <profile>`        | 提议者配置文件                      | _必填_                   |
| `--challenger <profile>`      | 挑战者配置文件                      | _必填_                   |
| `--judge <profile>`           | 裁判 profile（默认从 proposer 推断） | 自动推断                |
| `--max-rounds <n>`            | 辩论最大轮数，达到后强制终止        | `10`                     |
| `--judge-every-n-rounds <n>`  | 裁判每 N 轮介入一次（必须小于 max-rounds） | `3`                |
| `--convergence-threshold <n>` | 立场距离 (0-1)，低于此值自动收敛    | `0.3`                    |
| `--model <model>`             | 所有角色的模型覆盖                  | —                        |
| `--proposer-model <model>`    | 提议者模型覆盖                      | —                        |
| `--challenger-model <model>`  | 挑战者模型覆盖                      | —                        |
| `--judge-model <model>`       | 裁判模型覆盖                        | —                        |
| `--output <dir>`              | 输出目录                            | `run_output/debate-<ts>` |
| `--headless`                  | 禁用 TUI（完成信息仍输出到 stdout） | `false`                  |
| `-v, --verbose`               | 详细日志                            | `false`                  |

> **参数校验规则：** `--judge-every-n-rounds` 必须小于 `--max-rounds`。`--convergence-threshold` 必须在 0 到 1 之间。

**模型优先级：** `--proposer-model` > `--model` > 配置文件 `model` 字段 > 提供商默认值。

### `crossfire resume <output-dir>`

恢复中断的辩论，从持久化事件重建状态。

| 选项                     | 说明           | 默认值           |
| ------------------------ | -------------- | ---------------- |
| `--proposer <profile>`   | 覆盖提议者配置 | 来自 `index.json` |
| `--challenger <profile>` | 覆盖挑战者配置 | 来自 `index.json` |
| `--judge <profile>`      | 覆盖裁判配置   | 来自 `index.json` |
| `--headless`             | 禁用 TUI       | `false`          |

### `crossfire replay <output-dir>`

回放已完成的辩论（支持变速）。无需智能体连接。

| 选项               | 说明         | 默认值 |
| ------------------ | ------------ | ------ |
| `--speed <n>`      | 回放速度倍率 | `1`    |
| `--from-round <n>` | 从指定轮开始 | 开头   |

> **当前行为：** `replay` 目前是 CLI 驱动、非交互式的回放流程。它会回放事件流，但不会暴露实时辩论里的命令解析器。

### `crossfire status <output-dir>`

显示辩论状态摘要。加 `--json` 输出机器可读格式。

```text
Debate Status
=============

Debate ID: d-20260321-143022
Topic: Should we adopt microservices?
Started: 2026-03-21T14:30:22.000Z
Ended: 2026-03-21T14:32:29.300Z
Duration: 2m 7s

Total Rounds: 8
Total Events: 4523
Termination Reason: convergence

Profiles:
  Proposer: proposer (claude_code)
    Model: claude-sonnet-4-20250514
  Challenger: challenger (codex)
    Model: o3-mini
  Judge: judge (claude_code)
    Model: claude-sonnet-4-20250514

Configuration:
  Max Rounds: 10
  Judge Every N Rounds: 3
  Convergence Threshold: 0.3
```

## 运行时命令

通过 `crossfire start` 启动实时辩论后，可在 TUI 输入栏中输入命令：

| 命令                        | 效果                           | 状态     |
| --------------------------- | ------------------------------ | -------- |
| `/stop`                     | 立即停止                       | ✅       |
| `/inject proposer <text>`   | 向提议者下一轮注入上下文       | ✅       |
| `/inject challenger <text>` | 向挑战者下一轮注入上下文       | ✅       |
| `/inject both <text>`       | 向双方下一轮都注入上下文       | ✅       |
| `/inject! proposer <text>`  | 高优先级注入（必须处理的指令） | ✅       |
| `/inject judge <text>`      | 立即触发裁判并附带用户指令     | ✅       |
| `/interrupt [role]`         | 在 provider 支持时中断当前活跃回合 | ✅    |
| `/pause`                    | 在当前回合结束后暂停辩论       | ✅       |
| `/resume`                   | 恢复已暂停的实时辩论           | ✅       |
| `/extend <n>`               | 增加 N 轮最大轮数              | ✅       |

**审批模式**（工具审批请求时自动激活）：`/approve`、`/deny` ✅

`crossfire resume` 现在复用了与 `crossfire start` 相同的实时命令接线，因此在恢复中断辩论时也可以继续使用 `/stop`、`/interrupt`、审批命令、inject 命令，以及 `/pause`、`/resume`、`/extend`。

## 支持的智能体

| 配置文件 `agent` 字段 | CLI 工具 | 传输方式                       |
| --------------------- | -------- | ------------------------------ |
| `claude_code`         | `claude` | 进程内 Agent SDK ≥0.1.77（异步生成器 + hooks） |
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

你是一名擅长技术辩论的智能体。请基于证据提出清晰论点。
每次回复结束后，使用 `debate_meta` 工具上报你的立场。
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

**裁判自动推断：** 未指定 `--judge` 时，Crossfire 自动选择与提议者适配器类型匹配的裁判配置（例如 `claude/proposer` 默认使用 `claude/judge`）。

内置角色契约是有区分的：

- proposer 和 challenger 配置都包含 research requirements，要求重要主张尽量基于代码或其他可用证据
- challenger 配置被要求在关键反驳前做验证，并尽量提出具体替代方案，而不只是反对
- judge 配置优先评估证据责任；如果一方缺少依据，应在评分和 reasoning 中体现，而不是由裁判替其做大范围调查

内置配置文件：

```text
profiles/
├── claude/    # proposer.md, challenger.md, judge.md
├── codex/     # proposer.md, challenger.md, judge.md
└── gemini/    # proposer.md, challenger.md, judge.md
```

## 输出文件

每次辩论在输出目录下产生以下文件：

| 文件                   | 说明                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `action-plan.html`     | 主要最终报告的 HTML 版本                                     |
| `action-plan.md`       | 同一份行动计划的 Markdown 版本                               |
| `transcript.html`      | 完整辩论记录的 HTML 版本                                     |
| `transcript.md`        | 同一份 transcript 的 Markdown 版本                           |
| `events.jsonl`         | 完整事件日志（每行一条 JSON）— 唯一事实来源                  |
| `index.json`           | 元数据、字节偏移、段清单、profile 信息和辩论配置             |
| `synthesis-debug.json` | 综合提示词组装元数据加上综合运行期诊断信息，便于排查或分析输出质量 |

恢复时会创建新的段文件（例如 `events-resumed-<ts>.jsonl`），并在 `index.json` 中追踪。

面向人类阅读的 transcript / action plan 输出会在提取后自动剥离嵌入的 `debate_meta` / `judge_verdict` JSON 块；这些结构化载荷仍会保留在 `events.jsonl` 和派生状态里。

如果基于模型的最终综合失败，Crossfire 仍会写出一个可用的回退版行动计划，而且该回退报告会结合 debate summary 做补强，而不只依赖稀疏的 draft 状态。

## 工作原理

1. **加载配置** — CLI 读取 YAML 配置文件，用 Zod 校验，并把 `agent` 字段映射到适配器类型。
2. **创建适配器** — 每个角色获得一个 `AgentAdapter` 实例，把提供商特定协议统一为共享事件流。
3. **事件总线** — 所有事件流经 `DebateEventBus`。TUI、EventStore（JSONL 持久化）和 TranscriptWriter 都订阅这个总线。
4. **回合循环** — 编排器从投影状态构建提示词，发送给当前智能体，等待 `turn.completed`，再轮到另一方。每次决策前都会从事件重新投影状态。
5. **结构化提取** — 智能体调用 `debate_meta` 上报立场、置信度、关键论点和让步。裁判调用 `judge_verdict` 给出评分和继续/停止建议，同时其提示词会优先惩罚缺乏依据的主张。
6. **增量提示词** — 第 1 轮发送完整系统提示词、主题和输出格式；后续轮次仅发送对手最新回复和可选裁判反馈。
7. **收敛检测** — Crossfire 跟踪立场差值、让步情况以及双方是否希望结束。达到阈值时可提前终止辩论。
8. **持久化** — 事件每 100ms 批量写入 JSONL，并在回合或辩论完成时同步刷新。完整日志支持确定性回放和恢复。
9. **最终综合** — 辩论结束后，Crossfire 会在独立综合会话中生成 `action-plan.md` / `action-plan.html`，记录综合诊断元数据供审计使用；如果模型综合失败，则回退到经 debate summary 补强的本地报告。

完整架构文档请从 **[docs/architecture/overview.md](docs/architecture/overview.md)** 进入。

> **注意：** 架构文档现在采用“入口页 + 子文档”结构。有疑问时以源码为准。

## 系统模型

Crossfire 围绕共享事件流构建，而不是围绕可变的运行时状态构建。

- **事件日志是权威事实来源** — 回放、恢复、transcript 生成和状态查看都从持久化事件推导
- **所有状态都通过投影获得** — 运行时状态通过 `projectState(events[])` 重建，从而保证回放和恢复的确定性
- **纯核心 / 副作用外壳** — `-core` 包承载可测试逻辑，外围包负责 CLI、适配器、文件 I/O 和渲染

## 架构概览

```text
packages/
├── adapter-core/        # 共享事件模型、AgentAdapter 接口、Zod schema、契约测试
├── adapter-claude/      # Claude Agent SDK 适配器（进程内异步生成器）
├── adapter-codex/       # Codex JSON-RPC 2.0 双向 stdio 适配器
├── adapter-gemini/      # Gemini 子进程适配器（A→B 降级）
├── orchestrator-core/   # 纯逻辑：状态投影、收敛、提示词构建、导演
├── orchestrator/        # 副作用：辩论运行器、DebateEventBus、EventStore、TranscriptWriter、综合流程
├── tui/                 # Ink（CLI 的 React）组件、TuiStore、EventSource/PlaybackClock
└── cli/                 # Commander.js 入口、YAML 配置系统、组装工厂
```

分层说明：

- **Adapters** 把不同提供商协议归一化为共享事件，并通过显式能力接口暴露差异
- **Orchestrator core** 基于投影状态做可回放的纯决策
- **Orchestrator** 负责运行辩论、持久化事件、写 transcript 和触发最终综合
- **TUI** 使用与实时执行相同的事件流做实时渲染和回放

## 当前限制

- `crossfire replay` 目前是非交互式的，不暴露实时辩论中的命令解析器
- `/jump turn <turnId>` 已能被 TUI 解析，但目前还没有实时处理逻辑
- external history injection 目前仍只是 adapter 内部恢复能力；还没有用户可用的 `--history-file` 或实时导入命令
- 在多段恢复后的运行中，`replay --from-round` 目前不可靠

## 扩展 Crossfire

如果要新增一个 provider，通常需要在新 package 中实现 `AgentAdapter`，把 provider 输出归一化为共享事件模型，跑通适配器契约测试，然后在 CLI 工厂层接好适配器创建逻辑，并补充对应 profiles。

设计细节建议从 **[docs/architecture/overview.md](docs/architecture/overview.md)** 开始，再看 **[docs/architecture/adapter-layer.md](docs/architecture/adapter-layer.md)** 和 **[docs/architecture/orchestrator.md](docs/architecture/orchestrator.md)**。

## 贡献指南

欢迎贡献！详见 **[CONTRIBUTING.md](CONTRIBUTING.md)**（英文），涵盖开发环境搭建、技术栈、测试说明、项目规范及新适配器开发指南。

## 许可证

MIT

## 致谢

基于 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)、[Codex CLI](https://github.com/openai/codex)、[Gemini CLI](https://github.com/google-gemini/gemini-cli)、[Ink](https://github.com/vadimdemedes/ink) 和 [Zod](https://github.com/colinhacks/zod) 构建。
