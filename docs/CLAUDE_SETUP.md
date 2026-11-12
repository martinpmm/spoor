# Connect Spoor to Claude

Spoor ships a local, read only MCP server (`bridge/dist/mcp.js`). Claude starts it over stdio; it opens `~/.spoor/events.db` in read only mode. Nothing is sent anywhere except the tool results that become part of your conversation.

Configuration screens change over time. If a step below does not match what you see, check the current docs:

- Claude Desktop, local MCP servers: <https://modelcontextprotocol.io/docs/develop/connect-local-servers>
- Claude Code, MCP: <https://code.claude.com/docs/en/mcp>

## 1. Build and register

```bash
npm install
npm run build
npm run register
```

`npm run register` prints the exact configuration block for your machine (absolute path to `node` and to `mcp.js`). Use that block: Claude Desktop does not always find `node` on the `PATH`, especially with nvm, fnm or Volta.

## 2a. Claude Desktop

Settings → Developer → Edit Config. This opens `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the `spoor` entry (merge it with any servers you already have):

```json
{
  "mcpServers": {
    "spoor": {
      "command": "/absolute/path/to/node",
      "args": ["--no-warnings", "/absolute/path/to/spoor/bridge/dist/mcp.js"]
    }
  }
}
```

Restart Claude Desktop. The `spoor` server appears in the tools menu of a new conversation.

## 2b. Claude Code

For every project (user scope):

```bash
claude mcp add spoor --scope user -- node --no-warnings /absolute/path/to/spoor/bridge/dist/mcp.js
```

Or for one project, in `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "spoor": {
      "command": "node",
      "args": ["--no-warnings", "/absolute/path/to/spoor/bridge/dist/mcp.js"]
    }
  }
}
```

Check with `claude mcp list`, or `/mcp` inside a session.

## 3. Ask

Start with the bundled prompt **find_automation_opportunities** (in Claude Desktop: the "+" menu → prompts from spoor; in Claude Code: `/mcp__spoor__find_automation_opportunities`), or ask directly:

- "What are my five most repeated workflows this week and how long does each take?"
- "Between which two systems do I copy and paste the most, and what data moves?"
- "Which fields do I fill in by hand with the same kind of value every day?"
- "What do I use AI tools for, and which of those requests repeat?"
- "Which workflow would you automate first and why?"
- "What are my top sites today?"

For a fuller review that also remembers past results, install the bundled skill [skills/spoor-workflows](../skills/spoor-workflows/SKILL.md). It finds repetitive tasks, hand-copied data and repeated AI prompts, compares with what your agent already remembers, and offers to save a summary (names and counts only) to the agent's memory. In Claude Code, from the root of the repository:

```bash
mkdir -p ~/.claude/skills && cp -r skills/spoor-workflows ~/.claude/skills/
```

## Tools

All read only. `from` and `to` accept `YYYY-MM-DD`, ISO 8601, epoch ms, `today`, `yesterday` or relative values like `7d` (default: the last 7 days).

| Tool                                           | What it returns                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `get_overview(from, to)`                       | Active time, top sites and screens by time, active hours, event counts by type, sessions |
| `list_sessions(from, to, domain?)`             | Sessions with start, duration, active time and main sites                                |
| `get_session(sessionId)`                       | Ordered events of one session, including typed values                                    |
| `top_sequences(from, to, length, minCount)`    | Most repeated activity sequences with count and average duration                         |
| `site_switches(from, to)`                      | Most frequent jumps between two sites, with copy → paste counts and samples              |
| `field_values(from, to, domain, urlTemplate?)` | What gets typed into each field of a screen                                              |
| `ai_usage(from, to)`                           | Prompts by site, hour and length, with prompt text                                       |
| `search_events(query, from, to)`               | Text search over templates, titles, labels and values                                    |
| `export_jsonl(from, to, path?)`                | Writes a JSONL file (default `~/.spoor/exports/`) for other tools                        |

Prompt: `find_automation_opportunities(from?, to?)`.

The setting **"Let Claude read typed values"** in the extension is honored by every tool. With it off, values, clipboard text and prompt text come back empty with their length and `valuesHidden: true`.

## Try it with demo data first

```bash
npm run demo -w bridge
```

writes a synthetic week (five known workflows) to `~/.spoor-demo/events.db` and prints a second server entry, `spoor-demo`, that points at it through `SPOOR_HOME`. Add it, ask "Use spoor-demo. What were my five most repeated workflows last week?", and compare with the list at the top of [`bridge/src/demo.ts`](../bridge/src/demo.ts).

## Inspect without Claude

```bash
npm run inspect -w bridge
```

opens the MCP Inspector against the server.

## No MCP? Use the fallback

The dashboard has **Export JSONL** for a date range and **Copy summary for Claude**, which copies top sites, top repeated sequences and AI usage as text you can paste into any conversation.

## Troubleshooting

- _"No Spoor database found yet"_: the bridge has not stored anything. Open the extension settings: it should say "Bridge connected". See the README troubleshooting section.
- _The server does not appear in Claude Desktop_: check the JSON is valid, the paths are absolute, and look at the MCP logs (Settings → Developer).
- _Different data folder_: set `SPOOR_HOME` in the server's `env` block (and register with `--data-dir` so the bridge writes there too).
