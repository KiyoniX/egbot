// The AI that drives the browser during a lesson. Each adapter starts its command-line agent in
// headless mode with the same MCP servers (Playwright for the browser, plus any server added by a
// local extension, see docs/extensions.md) and returns what it printed. Pick one with "agent" in config.json:
//   claude  Claude Code    (npm @anthropic-ai/claude-code, installed with the bot)   tested
//   codex   OpenAI Codex   (npm @openai/codex, optional)                             not tested
//   gemini  Gemini CLI     (npm @google/gemini-cli, optional)                        not tested
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './users.mjs';

const win = process.platform === 'win32';
const RUN_TIMEOUT_MS = 45 * 60 * 1000;
const TOOL_TIMEOUT_MS = 120 * 1000; // default time limit of one MCP tool call

// The MCP servers every agent gets, as { name: { command, args, timeoutMs } }. `extra` comes from
// extensions; timeoutMs is the longest a call to one of its tools may take.
function mcpServers(user, extra = {}) {
  const args = [
    path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js'),
    '--browser', user.browser,
    '--user-data-dir', path.join(user.dir, 'browser-profile'),
  ];
  if (user.headless) args.push('--headless');
  if (user.noSandbox) args.push('--no-sandbox');
  return { playwright: { command: process.execPath, args, timeoutMs: TOOL_TIMEOUT_MS }, ...extra };
}

// Finds an agent's command: the bot's node_modules first, then the PATH.
function findBin(name) {
  const local = path.join(root, 'node_modules', '.bin', win ? `${name}.cmd` : name);
  return fs.existsSync(local) ? local : name;
}

// Runs a command, writes `input` to its stdin, resolves with { stdout, stderr }.
function runCli(bin, args, { cwd, env, input }) {
  // .cmd shims need a shell on Windows, where arguments must then be quoted by hand.
  const q = (s) => (win && /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  return new Promise((resolve) => {
    const child = spawn(win ? q(bin) : bin, win ? args.map(q) : args,
      { cwd, env, shell: win, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.on('error', (e) => { stderr += `\n${e.message}`; });
    child.on('close', () => { clearTimeout(timer); resolve({ stdout, stderr }); });
    child.stdin.end(input);
  });
}

// TOML basic strings share JSON's escapes for the characters used here.
const timeoutOf = (s) => s.timeoutMs || TOOL_TIMEOUT_MS;
const toml = (value) => (Array.isArray(value) ? `[${value.map(toml).join(', ')}]` : JSON.stringify(String(value)));

const ADAPTERS = {
  // Claude Code: subscription token (claude setup-token) in CLAUDE_CODE_OAUTH_TOKEN, or an API key
  // in ANTHROPIC_API_KEY.
  async claude(user, prompt, extra) {
    const servers = mcpServers(user, extra);
    const mcpPath = path.join(user.dir, 'mcp.generated.json');
    const config = Object.fromEntries(Object.entries(servers).map(([n, s]) => [n, { command: s.command, args: s.args }]));
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: config }, null, 2));
    const args = [
      '-p',
      '--mcp-config', mcpPath,
      '--strict-mcp-config',
      '--allowedTools', Object.keys(servers).map((n) => `mcp__${n}`).join(','),
      '--max-turns', String(user.maxTurns),
    ];
    if (user.model) args.push('--model', user.model);
    // One timeout for all servers: the longest one asked for.
    const env = { ...process.env, MCP_TOOL_TIMEOUT: String(Math.max(...Object.values(servers).map(timeoutOf))) };
    const token = user.secret('CLAUDE_CODE_OAUTH_TOKEN');
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
    const apiKey = user.secret('ANTHROPIC_API_KEY');
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    return runCli(findBin('claude'), args, { cwd: user.dir, env, input: prompt });
  },

  // OpenAI Codex: API key in CODEX_API_KEY, or a login made once with
  //   CODEX_HOME=users/<id>/codex codex login --device-auth
  // Its own config lives in users/<id>/codex/config.toml, rewritten at each run.
  async codex(user, prompt, extra) {
    const home = path.join(user.dir, 'codex');
    fs.mkdirSync(home, { recursive: true });
    const lines = [
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
    ];
    if (user.model) lines.push(`model = ${toml(user.model)}`);
    for (const [name, s] of Object.entries(mcpServers(user, extra))) {
      lines.push('', `[mcp_servers.${name}]`, `command = ${toml(s.command)}`, `args = ${toml(s.args)}`,
        'startup_timeout_sec = 60',
        `tool_timeout_sec = ${Math.ceil(timeoutOf(s) / 1000)}`,
        // Without this, codex exec cancels MCP calls while waiting for a human approval.
        'default_tools_approval_mode = "approve"');
    }
    fs.writeFileSync(path.join(home, 'config.toml'), lines.join('\n') + '\n');
    const env = { ...process.env, CODEX_HOME: home };
    const apiKey = user.secret('CODEX_API_KEY');
    if (apiKey) env.CODEX_API_KEY = apiKey;
    return runCli(findBin('codex'), ['exec', '--skip-git-repo-check', '-'],
      { cwd: user.dir, env, input: prompt });
  },

  // Gemini CLI: API key in GEMINI_API_KEY. Its settings are written to users/<id>/.gemini/settings.json
  // (workspace settings, read from the working directory). "trust" lets the bot's MCP servers run
  // without confirmation; other tools that need one are refused in headless mode.
  async gemini(user, prompt, extra) {
    const servers = mcpServers(user, extra);
    const settings = {
      mcpServers: Object.fromEntries(Object.entries(servers).map(([name, s]) => [name, {
        command: s.command, args: s.args, trust: true, timeout: timeoutOf(s),
      }])),
      model: { maxSessionTurns: user.maxTurns },
    };
    fs.mkdirSync(path.join(user.dir, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(user.dir, '.gemini', 'settings.json'), JSON.stringify(settings, null, 2));
    const args = ['--allowed-mcp-server-names', Object.keys(servers).join(','), '--output-format', 'text'];
    if (user.model) args.push('--model', user.model);
    const env = { ...process.env };
    const apiKey = user.secret('GEMINI_API_KEY');
    if (apiKey) env.GEMINI_API_KEY = apiKey;
    return runCli(findBin('gemini'), args, { cwd: user.dir, env, input: prompt });
  },
};

export const AGENTS = Object.keys(ADAPTERS);

// Runs the user's agent on the prompt. Resolves with { stdout, stderr }: the final answer (with the
// RESULT line) is expected on stdout.
export function runAgent(user, prompt, extra = {}) {
  const agent = user.agent || 'claude';
  if (!ADAPTERS[agent]) throw new Error(`Unknown agent "${agent}" (choose: ${AGENTS.join(', ')}).`);
  return ADAPTERS[agent](user, prompt, extra);
}
