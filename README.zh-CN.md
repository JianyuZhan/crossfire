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
- [执行模式](#执行模式)
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
- **实时终端 UI** — 分屏面板，实时展示消息流、保留思考摘要、持久保留的工具前说明文本、自动换行的工具调用、带本地回退的工具运行计时、高亮审批卡片和收敛指标
- **事件溯源** — 所有事件持久化为 JSONL。支持中断恢复，并可从同一事实来源回放已完成辩论
- **结构化提取** — 智能体通过 tool call 上报立场、置信度、关键论点和让步（Zod 校验）
- **裁判仲裁** — 可选的裁判智能体评分论证、检测停滞、可提前终止辩论，并优先评估证据责任而不是奖励无依据断言
- **自适应最终综合** — 辩论结束后在独立综合会话中生成最终行动计划，并强制综合阶段走无工具的 `plan` turn；模型综合失败时仍有结构化本地回退
- **增量提示词** — 第 1 轮发送完整上下文，第 2 轮起仅发送对手/裁判的新消息，利用提供商会话记忆实现每轮 ~O(1) token 开销
- **配置文件驱动** — `crossfire.json` 在单个文件中定义角色、provider 绑定、MCP 服务器和 policy preset
- **策略预设** — 支持 debate 默认模式、按角色 baseline，以及 `research`、`guarded`、`dangerous`、`plan` 这类按 turn 覆盖

## 适用场景

- **架构评审** — 压力测试设计提案、权衡点和迁移路径
- **产品决策** — 在做路线图或重大判断前暴露隐藏假设
- **风险发现** — 强制产出让步、反论点和未解决问题
- **研究综合** — 在一个终端工作流里把对立观点收敛成结构化行动计划

## 你将得到什么

- **实时辩论界面** — 全屏终端 UI，按轮次展示推理过程、保留思考摘要、持久保留的工具前说明文本、自动换行的工具细节、带本地回退的工具运行计时、审批提示、裁判反馈和收敛进度
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
# 首先创建配置文件 (crossfire.json) 定义角色和 provider 绑定
# 详见下方"配置文件格式"章节

# Claude 对战 Claude（裁判自动推断）
crossfire start \
  --config crossfire.json \
  --topic "Should we adopt microservices?" \
  --max-rounds 5 \
  --output run_output/microservices

# 使用显式 preset
crossfire start \
  --config crossfire.json \
  --topic "Is caching always better than recomputing?" \
  --proposer-preset research \
  --challenger-preset guarded

# 无界面模式（完成信息仍输出到 stdout）
crossfire start \
  --config crossfire.json \
  --topic "Quick brainstorm" \
  --headless -v
```

上面的示例之所以输出到 `run_output/microservices/`，是因为显式传入了 `--output run_output/microservices`。如果省略 `--output`，Crossfire 会写入带时间戳的辩论目录，例如 `run_output/d-20260331-224500/`。随后优先查看其中的 `action-plan.html` 或 `action-plan.md`，也可以用 `crossfire status <output-dir>` 查看摘要，或用 `crossfire replay <output-dir>` 回放事件日志。

## 策略预设

策略预设是 Crossfire 用来缓解审批疲劳的上层抽象。重点不是把三家 provider 硬压成同一排审批按钮，而是让编排层先决定”这一 turn 应该有多强的执行自由度”，再交给各 adapter 去做真实映射。

可以这样理解：

- Crossfire 负责定义 turn 的交互强度
- 各 adapter 负责把它映射到底层 provider 真正支持的官方原语
- event log 和 TUI 会记录每个 turn 实际生效的是哪一档模式

当前有三档 baseline 模式，以及一个特殊的 per-turn override：

- `research`
  低打扰研究模式。优先走安全或只读倾向的行为，尽量减少审批噪音。
  对 Claude 来说，这一档还会带一个保守的单 turn query 上限，避免同一轮 research 无限扩散。
- `guarded`
  受控执行模式。最接近过去“正常审批”的默认心智。
- `dangerous`
  高信任执行模式。尽量减少中断，但风险最高。
- `plan`
  只作为按 turn 覆盖使用。适合先看 agent 打算怎么做，再决定是否放开执行权限。

为什么 `plan` 不作为长期 baseline：

- debate 的质量通常依赖真实的读取、搜索和验证
- 如果把 `plan` 当常驻模式，很多 turn 会退化成纯 LLM 推理，证据质量明显下降
- 实际上它更适合做“一轮预演”，而不是整场 debate 的常态

优先级规则是：

```text
CLI 角色特定 > CLI 全局 > 配置文件 > 角色默认
```

也就是说：

- `--preset` 设置所有角色的 debate 默认模式
- `--proposer-preset` / `--challenger-preset` 覆盖某个角色的 baseline
- `--turn-preset p-1=plan` 或 `--turn-preset c-2=dangerous` 只覆盖指定 turn
- 配置文件中可以设置按角色的 `preset` 字段作为 baseline 默认值

示例：

```bash
# 整场 debate 的默认模式
crossfire start \
  --config crossfire.json \
  --topic "Should we migrate to Rust?" \
  --preset guarded
```

```bash
# 两个角色用不同 baseline
crossfire start \
  --config crossfire.json \
  --topic "Should we rebuild the auth service?" \
  --proposer-preset research \
  --challenger-preset guarded
```

```bash
# 在 proposer 第 1 轮前强制先出计划
crossfire start \
  --config crossfire.json \
  --topic "Should we move to event sourcing?" \
  --proposer-preset research \
  --turn-preset p-1=plan
```

三家 provider 的当前映射是故意不对称的：

- **Claude**
  `research -> dontAsk + allowlist + bounded maxTurns`，`guarded -> default`，`dangerous -> bypassPermissions`，`plan -> plan`
- **Codex**
  主要映射到 approval policy 和 sandbox policy 的组合，而不是单一 mode 字段
- **Gemini**
  当前 headless 接法只做启动/每 turn 的 approval-profile 映射，不应假设和 Claude/Codex 有同等 runtime parity

实用建议：

- proposer 如果经常做大量 research，优先试 `--proposer-preset research`
- 对 Claude 而言，`research` 是有意做了收束的；如果你就是想放长一轮自由探索，再考虑升到 `guarded` 或 `dangerous`
- challenger 如果你仍希望保留明确控制，先用 `--challenger-preset guarded`
- 想先看 agent 打算怎么做，再决定要不要放开权限时，用 `--turn-preset p-1=plan`
- `dangerous` 只适合边界明确、可信度高、你愿意接受更少人工制动机会的任务

## 终端 UI

终端 UI 是基于 Ink（CLI 的 React）的全屏应用，由四个垂直区域组成：

- **顶部栏** — 居中品牌标识、辩论 ID、轮次/阶段、提议者与挑战者的智能体信息、辩论主题
- **可滚动内容区** — 按轮次展示智能体消息、思考过程、持久保留的工具前说明文本和自动换行的工具调用，长命令和长参数不会再被硬截断。支持方向键、`Ctrl+U`/`Ctrl+D`、`Home`/`End` 滚动
- **工具活跃度** — 即使 provider 只发 `tool.call` / `tool.result`，中间没有 `tool.progress`，运行中的工具行和 live header 也会显示本地维护的耗时，避免页面看起来像卡住
- **指标栏** — 各智能体 token 用量与费用、收敛进度条与百分比、裁判判定、滚动状态（LIVE / SCROLLED）。用量统计会标明 provider 口径，例如 `session delta`、`per turn`、`thread cumulative`，避免把不同 provider 的数字误当成可直接横向比较
- **固定 live 状态** — metrics bar 的第一行会单独显示当前活跃角色的紧凑 `Active: ...` 摘要，因此即使工具流很长、顶部 round header 被刷出视口，也还能看到现在是谁在跑、跑了多久
- **压缩工具失败摘要** — live 工具区会把重复失败折叠成 `recent failures: 404×5, 403×2` 这类短摘要；如果要看最完整的原始细节，去 `run_output/<debate-id>/events.jsonl`
- **live 工具区只保留当前工作** — 成功完成的工具会立即从 live 列表消失，失败则压缩成摘要；如果要看完整已完成明细，可以去 round snapshot 或 `events.jsonl`
- **Claude 六态工具模型** — Claude 的工具请求现在会被投影为 `requested`、`running`、`succeeded`、`failed`、`denied`、`unknown`，而不是假设每条 `tool.call` 都已经真正开始执行。provider 发出 `tool.progress` 后才升级为 `running`，权限拒绝会收束成 `denied`，只有观察到终态 hook 才会被判成 `succeeded` / `failed`
- **未闭合工具自动收束** — 如果某个 turn 结束时 provider 侧工具请求始终没有给出终态 hook，Crossfire 会把这些 live 行收束为 `unknown outcome`，不再让它们永远停留在 `running`
- **命令/审批区** — 实时辩论中根据上下文切换提示符（`>`、`approval>`），并在有待审批请求时展开高亮卡片，显示待调用的工具/命令、批量操作，以及带 provider 语义的短命令，如 `/approve 2`、`/approve 2 2` 或 `/approve all`
- **模式可见性** — proposer / challenger 的 header 会直接以内联形式显示 `Role [provider] [mode: ...]`，不用再去看单独一行状态，方便快速判断当前是 `research`、`guarded`、`dangerous` 还是 `plan`

使用 `--headless` 可跳过 UI。事件和综合输出仍会落盘，之后可以回放或审阅。

## CLI 参考

### `crossfire start`

启动新辩论。

| 选项                          | 说明                                | 默认值                   |
| ----------------------------- | ----------------------------------- | ------------------------ |
| `--config <path>`             | 包含角色和 provider 绑定的配置文件  | _必填_                   |
| `--topic <text>`              | 辩论主题                            | —                        |
| `--topic-file <path>`         | 从文件读取主题（与 `--topic` 互斥） | —                        |
| `--max-rounds <n>`            | 辩论最大轮数，达到后强制终止        | `10`                     |
| `--judge-every-n-rounds <n>`  | 裁判每 N 轮介入一次（必须小于 max-rounds） | `3`                |
| `--convergence-threshold <n>` | 立场距离 (0-1)，低于此值自动收敛    | `0.3`                    |
| `--model <model>`             | 所有角色的模型覆盖                  | —                        |
| `--proposer-model <model>`    | 提议者模型覆盖                      | —                        |
| `--challenger-model <model>`  | 挑战者模型覆盖                      | —                        |
| `--judge-model <model>`       | 裁判模型覆盖                        | —                        |
| `--preset <preset>`           | debate 默认策略预设（`research`、`guarded`、`dangerous`） | —     |
| `--proposer-preset <preset>`  | proposer baseline 策略预设          | —                        |
| `--challenger-preset <preset>`| challenger baseline 策略预设        | —                        |
| `--judge-preset <preset>`     | judge baseline 策略预设             | —                        |
| `--turn-preset <turnId=preset>` | 可重复的按 turn 覆盖，支持 `plan` | —                        |
| `--template <family>`         | 所有角色的提示词模板族（`auto`、`general`、`code`） | `auto` |
| `--proposer-template <family>` | proposer 提示词模板覆盖            | 继承 `--template` |
| `--challenger-template <family>` | challenger 提示词模板覆盖       | 继承 `--template` |
| `--judge-template <family>`   | judge 提示词模板覆盖                | 继承 `--template` |
| `--output <dir>`              | 输出目录                            | `run_output/d-YYYYMMDD-HHMMSS` |
| `--headless`                  | 禁用 TUI（完成信息仍输出到 stdout） | `false`                  |
| `-v, --verbose`               | 详细日志                            | `false`                  |

> **参数校验规则：** `--judge-every-n-rounds` 必须小于 `--max-rounds`。`--convergence-threshold` 必须在 0 到 1 之间。

策略预设优先级：

```text
CLI 角色特定 > CLI 全局 > 配置文件 > 角色默认
```

**模型优先级：** `--proposer-model` > `--model` > 配置文件 `model` 字段 > 提供商默认值。

### `crossfire resume <output-dir>`

恢复中断的辩论，从持久化事件重建状态。

| 选项             | 说明       | 默认值           |
| ---------------- | ---------- | ---------------- |
| `--config <path>`| 覆盖配置   | 来自 `index.json` |
| `--headless`     | 禁用 TUI   | `false`          |

配置更改（角色、preset、模型覆盖）在 resume 时允许，但你不能给一个最初无裁判的 debate 临时补加 judge。

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
  Proposer: claude_proposer (claude_code)
    Model: us.anthropic.claude-opus-4-6-v1
  Challenger: codex_challenger (codex)
    Model: gpt-5.4
  Judge: claude_judge (claude_code)
    Model: us.anthropic.claude-opus-4-6-v1

Configuration:
  Max Rounds: 10
  Judge Every N Rounds: 3
  Convergence Threshold: 0.3
```

### `crossfire inspect-policy --config <path>`

检查给定配置文件的策略编译。显示每个角色的已解析 preset、策略层和 provider 转换。

```bash
crossfire inspect-policy --config crossfire.json
```

### `crossfire inspect-tools --config <path> [--role <role>]`

检查配置文件中特定角色的工具/MCP 服务器接线。显示可用工具及其来源。

```bash
crossfire inspect-tools --config crossfire.json --role proposer
```

## 运行时命令

通过 `crossfire start` 启动实时辩论后，可在 TUI 输入栏中输入命令：

| 命令                        | 效果                           | 状态     |
| --------------------------- | ------------------------------ | -------- |
| `/stop`                     | 立即停止                       | ✅       |
| `/inject proposer <text>`   | 向提议者下一轮注入上下文       | ✅       |
| `/inject challenger <text>` | 向挑战者下一轮注入上下文       | ✅       |
| `/inject both <text>`       | 向双方下一轮都注入上下文       | ✅       |
| `/inject! <target> <text>`  | 面向 `proposer`、`challenger` 或 `both` 的高优先级注入 | ✅ |
| `/inject judge <text>`      | 在当前 round 结束后追加一次带用户指令的裁判回合 | ✅ |
| `/interrupt [role]`         | 在 provider 支持时中断当前活跃回合 | ✅    |
| `/pause`                    | 在当前回合结束后暂停辩论       | ✅       |
| `/resume`                   | 恢复已暂停的实时辩论           | ✅       |
| `/extend <n>`               | 增加 N 轮最大轮数              | ✅       |
| `/status policy`            | 显示每个角色的有效策略状态（预设、能力、约束、警告） | ✅ |
| `/status tools`             | 显示每个角色的有效工具表面（工具视图、能力效果；尽力而为） | ✅ |

**审批模式**（有审批请求时自动激活）：`/approve`、`/deny`、`/approve <序号>`、`/deny <序号>`、`/approve <序号> <选项序号>`、`/deny <序号> <选项序号>`、`/approve all`、`/deny all` ✅  
TUI 会把待处理审批展开成高亮区块，显示 provider、审批类型、请求摘要、逐条序号快捷命令、provider-aware 的选项行，以及批量 approve / reject 指令。如果当前所有待审批请求都共享同一个 session 级 allow 选项，还会直接提示类似 `/approve all 2` 的批量快捷命令。Claude 的工具审批现在会通过 Crossfire 的统一审批能力稳定暴露 session 级 allow 选项；Codex 在 provider 发送原生决策列表时也会直接展示。

`crossfire resume` 现在复用了与 `crossfire start` 相同的实时命令接线，因此在恢复中断辩论时也可以继续使用 `/stop`、`/interrupt`、审批命令、inject 命令，以及 `/pause`、`/resume`、`/extend`。

Inject 语义说明：

- proposer / challenger / both 的 inject 都是 one-shot guidance，会在下一次目标 prompt 构建时被消费
- 如果同一目标在下一次发言前连续 inject 多次，当前实现是后写覆盖前写，不会自动拼接
- `/inject judge` 不会在当前 speaker 说到一半时硬插入，而是在下一个 round 结束后的检查点追加一次裁判回合

## 支持的智能体

| 配置文件 `agent` 字段 | CLI 工具 | 传输方式                       |
| --------------------- | -------- | ------------------------------ |
| `claude_code`         | `claude` | 进程内 Agent SDK ≥0.1.77（异步生成器 + hooks） |
| `codex`               | `codex`  | 双向 JSON-RPC 2.0 over stdio   |
| `gemini_cli`          | `gemini` | 每轮子进程                     |

任何智能体可以担任任何角色（提议者、挑战者或裁判），自由混搭。

## 配置文件格式

Crossfire 使用 `crossfire.json` 配置文件定义角色、provider 绑定、MCP 服务器和策略预设。

**`crossfire.json` 示例：**

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  },
  "providerBindings": [
    {
      "name": "claude-main",
      "adapter": "claude",
      "model": "claude-sonnet",
      "mcpServers": ["github"]
    },
    {
      "name": "codex-main",
      "adapter": "codex",
      "model": "gpt-5.4"
    }
  ],
  "roles": {
    "proposer": {
      "binding": "claude-main",
      "preset": "research"
    },
    "challenger": {
      "binding": "codex-main",
      "preset": "guarded"
    },
    "judge": {
      "binding": "claude-main",
      "preset": "plan"
    }
  }
}
```

| 字段 | 说明 | 必填 |
| ---- | ---- | ---- |
| `mcpServers` | 共享 MCP 服务器定义注册表 | 否 |
| `providerBindings` | Provider 绑定列表 | 是 |
| `roles.proposer` | 提议者角色配置 | 是 |
| `roles.challenger` | 挑战者角色配置 | 是 |
| `roles.judge` | 裁判角色配置（可选） | 否 |

**角色配置字段：**

| 字段 | 说明 | 必填 | 默认值 |
| ---- | ---- | ---- | ------ |
| `binding` | Provider 绑定名 | 是 | — |
| `model` | 当前角色的模型覆盖 | 否 | binding 默认 |
| `preset` | 策略预设（`research`、`guarded`、`dangerous`、`plan`） | 否 | 角色默认（proposer/challenger 为 `guarded`，judge 为 `plan`） |
| `systemPrompt` | 角色级 system prompt 覆盖 | 否 | binding / 内置默认值 |

**Provider 绑定字段：**

| 字段 | 说明 | 必填 | 默认值 |
| ---- | ---- | ---- | ------ |
| `name` | 被角色引用的 binding 标识 | 是 | — |
| `adapter` | Adapter 类型（`claude`、`codex`、`gemini`） | 是 | — |
| `model` | Binding 级默认模型 | 否 | adapter 默认 |
| `providerOptions` | Provider 原生 escape hatch（不是 policy 语义） | 否 | — |
| `mcpServers` | 来自顶层注册表的已附着 MCP 服务器名称 | 否 | `[]` |

## 配置文件（旧版）

> **注意：** 基于 profile 的方式（`--proposer <profile>`、`--challenger <profile>`）已被弃用，请使用 `--config <path>`。内置 provider profile 仍用于内部测试和示例，但生产环境应迁移到配置文件格式。

Crossfire 之前使用独立的 provider/runtime profile 和可复用角色提示词。

provider profile 使用 JSON：

```json
{
  "name": "my_debater",
  "description": "A skilled technical debater",
  "agent": "claude_code",
  "model": "us.anthropic.claude-opus-4-6-v1",
  "prompt_family": "auto",
  "inherit_global_config": true,
  "mcp_servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-filesystem"]
    }
  }
}
```

| 字段                    | 说明                                              | 必填 | 默认值     |
| ----------------------- | ------------------------------------------------- | ---- | ---------- |
| `name`                  | 配置标识符                                        | 是   | —          |
| `description`           | 可读描述                                          | 否   | —          |
| `agent`                 | 智能体类型 (`claude_code`, `codex`, `gemini_cli`) | 是   | —          |
| `model`                 | 首选模型                                          | 否   | 提供商默认 |
| `prompt_family`         | 默认提示词模板族 (`auto`、`general`、`code`)      | 否   | `auto`     |
| `inherit_global_config` | 合并用户全局 MCP 配置                             | 否   | `true`     |
| `mcp_servers`           | 配置文件专属 MCP 服务器                           | 否   | `{}`       |

角色提示词是普通 Markdown 文件，放在 `prompts/<family>/<role>.md`。

**搜索路径：**

- provider profile：`./profiles/providers/` → `~/.config/crossfire/profiles/providers/`
- prompt template：`./prompts/` → `~/.config/crossfire/prompts/`

**裁判自动推断：** 未指定 `--judge` 时，Crossfire 自动选择与提议者适配器类型匹配的裁判配置（例如 `claude/proposer` 默认使用 `claude/judge`）。

内置提示词现在分成两层：

- provider profile 负责选择 adapter、默认模型和运行时接线
- prompt template 负责定义 `proposer`、`challenger`、`judge` 的角色契约
- `general` 模板族用于商业、产品、研究类主题
- 内置 proposer 模板现在会强制输出可执行方案，而不是停留在大方向；`general/proposer` 会覆盖定位、经济模型、控制措施、渠道保护和运营机制，`code/proposer` 会覆盖实现细节、迁移、测试、安全和发布落地
- 内置 challenger 模板现在都会强制做多维度挑战，而不是停留在泛泛反对；`general/challenger` 会覆盖信任/转化、定价滥用、安全合规、渠道绕过和执行成本，`code/challenger` 会覆盖正确性、回归风险、测试、安全、运维和发布落地
- 内置 judge 模板现在也会惩罚浅层风险清单和草率收敛，更明确要求基于证据的挑战、具体 failure mode，以及尚未闭环的高杠杆问题
- `code` 模板族用于仓库、实现、调试类主题
- `--template auto` 会先发起一次轻量 classifier 调用，使用 judge profile 对应的 provider/model 在 `general` 和 `code` 之间做选择
- 如果 classifier 超时或没有返回合法 JSON，Crossfire 会退回本地启发式判定
- `--proposer-template`、`--challenger-template`、`--judge-template` 仍然可以手工覆盖，并直接跳过 classifier

这套拆分现在对 Claude、Codex、Gemini 是对称的。Crossfire 不再只给 Codex 特判“代码型 challenger 提示词”；三家内置 provider 都共享 `general` 和 `code` 两个角色模板族，而 provider 差异只留在 profile/runtime 层。

内置文件结构：

```text
profiles/
└── providers/
    ├── claude/   # proposer.json, challenger.json, judge.json
    ├── codex/    # proposer.json, challenger.json, judge.json
    └── gemini/   # proposer.json, challenger.json, judge.json
prompts/
├── general/      # proposer.md, challenger.md, judge.md
└── code/         # proposer.md, challenger.md, judge.md
```

典型用法：

```bash
# 让 Crossfire 自动分类模板族
crossfire start \
  --config crossfire.json \
  --topic "Should we launch an API resale product?" \
  --template auto
```

```bash
# 强制所有角色都使用 code 模板
crossfire start \
  --config crossfire.json \
  --topic "Should we rewrite the data layer?" \
  --template code
```

```bash
# 按角色使用不同模板族
crossfire start \
  --config crossfire.json \
  --topic "Should we rewrite the data layer?" \
  --proposer-template general \
  --challenger-template code
```

```bash
# 组合 preset baseline、turn override 和模板选择
crossfire start \
  --config crossfire.json \
  --topic "Should we rewrite the data layer?" \
  --proposer-preset research \
  --challenger-preset guarded \
  --turn-preset p-1=plan \
  --template code
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

如果基于模型的最终综合失败，Crossfire 仍会写出一个可用的回退版行动计划，而且该回退报告会结合 debate summary 做补强，而不只依赖稀疏的 draft 状态；同时 executive summary 会保持为短的结构化段落，不再把整段裁判长文直接塞进 recommendation。

## 工作原理

1. **加载配置** — CLI 读取 JSON provider profile，用 Zod 校验，并把 `agent` 字段映射到适配器类型。
2. **解析提示词模板** — Crossfire 会从 `--template`、按角色的 `--*-template` 覆盖、profile 的 `prompt_family`，或轻量 topic classifier 的回退结果中解析出 `general` / `code` 模板族，然后加载 `prompts/<family>/<role>.md`。这套机制现在对所有内置 provider 对称生效。
3. **创建适配器** — 每个角色获得一个 `AgentAdapter` 实例，把提供商特定协议统一为共享事件流。
4. **事件总线** — 所有事件流经 `DebateEventBus`。TUI、EventStore（JSONL 持久化）和 TranscriptWriter 都订阅这个总线。
5. **回合循环** — 编排器从投影状态构建提示词，发送给当前智能体，等待 `turn.completed`，再轮到另一方。每次决策前都会从事件重新投影状态。
6. **结构化提取** — 智能体调用 `debate_meta` 上报立场、置信度、关键论点和让步。裁判调用 `judge_verdict` 给出评分和继续/停止建议，同时其提示词会优先惩罚缺乏依据的主张。
7. **增量提示词** — 第 1 轮发送完整系统提示词、主题和输出格式；后续轮次仅发送对手最新回复和可选裁判反馈。
8. **收敛检测** — Crossfire 跟踪立场差值、让步情况以及双方是否希望结束。达到阈值时可提前终止辩论。
9. **持久化** — 事件每 100ms 批量写入 JSONL，并在回合或辩论完成时同步刷新。完整日志支持确定性回放和恢复。
10. **最终综合** — 辩论结束后，Crossfire 会在独立综合会话中生成 `action-plan.md` / `action-plan.html`，综合 turn 会以无工具的 `plan` 模式运行并拥有更长的 timeout 预算；同时记录综合诊断元数据供审计使用。如果模型综合失败，则回退到经 debate summary 补强的本地报告。

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
└── cli/                 # Commander.js 入口、JSON 配置系统、组装工厂
```

分层说明：

- **Adapters** 把不同提供商协议归一化为共享事件，并通过显式能力接口暴露差异
- **Orchestrator core** 基于投影状态做可回放的纯决策
- **Orchestrator** 负责运行辩论、持久化事件、写 transcript 和触发最终综合
- **TUI** 使用与实时执行相同的事件流做实时渲染和回放

## 当前限制

- `crossfire replay` 目前是非交互式的，不暴露实时辩论中的命令解析器
- `/jump turn <turnId>` 已能被 TUI 解析，但目前还没有实时处理逻辑
- `crossfire status` 对真正进行中的辩论仍只有有限的特殊处理
- external history injection 目前仍只是 adapter 内部恢复能力；还没有用户可用的 `--history-file` 或实时导入命令
- TODO：如果未来把 external history injection 做成产品能力，优先考虑 `start/resume --history-file <json>`，而不是实时导入命令，这样导入上下文仍然满足 event-sourced 和 replay-safe
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
