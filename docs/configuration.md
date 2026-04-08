# User Configuration

Crossfire is configured through `crossfire.json`.

The current runtime surface is config-first:

- use `providerBindings` to define which provider CLI and model are available
- use `roles.*.binding` to decide which binding each role uses
- use `preset` to choose the baseline policy
- use `template` to reuse evidence and interaction overrides
- use `evidence`, `systemPrompt`, or `systemPromptFile` for per-role tuning
- use `mcpServers` only when you want to attach extra MCP tools

## Start Here

Copy the checked-in reference file:

```bash
cp crossfire.example.json crossfire.json
```

Then edit it in this order:

1. Change the `providerBindings` entries to the CLIs and models you actually have installed (`claude`, `codex`, or `gemini`).
2. Add or edit as many provider bindings as you want. The same adapter can appear multiple times with different `name` and `model` values.
3. Point `roles.proposer.binding`, `roles.challenger.binding`, and `roles.judge.binding` at the binding you want each role to use.
4. Pick a `preset` or `template` for each role.
5. Add optional `systemPromptFile`, `systemPrompt`, or role `evidence` only when you need extra guidance.
6. Run inspection before the first real debate:

```bash
crossfire inspect-policy --config crossfire.json
crossfire inspect-tools --config crossfire.json
```

## Mental Model

### `providerBindings`

This is where provider-specific setup lives:

- `adapter`: `claude`, `codex`, or `gemini`
- `model`: binding-level default model
- `mcpServers`: optional attached MCP server names
- `providerOptions`: provider-native escape hatch, not part of the shared policy model

You can repeat the same adapter many times:

- `claude-fast` -> `claude` + Sonnet
- `claude-deep` -> `claude` + Opus
- `codex-main` -> `codex` + GPT-5.4

### `roles`

This is where debate behavior is chosen:

- `binding`: which provider binding the role uses
- `preset`: baseline policy (`research`, `guarded`, `dangerous`, `plan`)
- `template`: reusable policy bundle layered on top of the preset
- `evidence.bar`: proof threshold override
- `systemPrompt`: inline prompt override for short text
- `systemPromptFile`: file-based prompt override for long prompts

Use one or the other for the same role, not both.

### `templates`

Templates are reusable policy shortcuts. Today they can override:

- `evidence.bar`
- `interaction.approval`
- `interaction.limits.maxTurns`

They do not override capabilities such as filesystem, network, shell, or subagents.

## Reference Config

The source-of-truth example is [`crossfire.example.json`](../crossfire.example.json).

It is intentionally basic:

- multiple bindings so the file shows all three adapters and repeated adapter usage
- one reusable template
- proposer/challenger/judge all configured explicitly
- file-based prompt overrides pointing at `prompts/`

If you want extra tools, add a top-level `mcpServers` registry and attach entries through `providerBindings[].mcpServers`.

## What You Can Not Configure Today

These are common assumptions that are currently false:

- no profile loading from `profiles/`
- no prompt-family selector; `prompts/` is now just a normal file location you can reference through `systemPromptFile`
- no per-tool allow or deny list in `crossfire.json`
- no capability override inside templates

If you need to understand the exact resolved runtime behavior, use `inspect-policy`, `inspect-tools`, `/status policy`, and `/status tools`.
