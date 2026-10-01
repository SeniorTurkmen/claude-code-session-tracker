import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildLauncherScript,
  buildPlist,
  isOneOffCache,
  LABEL,
  launcherScriptPath,
  plistPath,
  resolveLauncher,
  runKeyCommand,
  windowsLogPath,
  windowsPidPath,
} from '../src/autostart.ts';

describe('isOneOffCache', () => {
  it('recognises what npx, pnpm dlx, yarn dlx and bunx unpack', () => {
    ok(isOneOffCache('/Users/a/.npm/_npx/1a2b/node_modules/claude-code-session-tracker/dist/cli.js'));
    ok(isOneOffCache('/Users/a/Library/Caches/pnpm/dlx/abc/node_modules/claude-code-session-tracker/dist/cli.js'));
    ok(isOneOffCache('/private/var/folders/x/xfs-1234/dlx-5/node_modules/claude-code-session-tracker/dist/cli.js'));
    ok(isOneOffCache('/var/tmp/bunx-501-claude-code-session-tracker/node_modules/claude-code-session-tracker/dist/cli.js'));
    ok(isOneOffCache(join(tmpdir(), 'anything', 'cli.js')));
  });

  it('accepts an install that stays put', () => {
    strictEqual(isOneOffCache('/opt/homebrew/bin/claude-code-session-tracker'), false);
    strictEqual(isOneOffCache('/usr/local/lib/node_modules/claude-code-session-tracker/dist/cli.js'), false);
  });
});

describe('resolveLauncher', () => {
  it('keeps the paths as given, so a Homebrew link outlives an upgrade', () => {
    deepStrictEqual(resolveLauncher('/opt/homebrew/bin/node', '/opt/homebrew/bin/claude-code-session-tracker'), {
      node: '/opt/homebrew/bin/node',
      cli: '/opt/homebrew/bin/claude-code-session-tracker',
    });
  });

  it('refuses a copy npx fetched for one run', () => {
    const result = resolveLauncher('/usr/local/bin/node', '/Users/a/.npm/_npx/1a2b/node_modules/.bin/claude-code-session-tracker');
    ok('error' in result);
    match(result.error, /npm install -g/);
  });

  it('refuses when there is no script path', () => {
    ok('error' in resolveLauncher('/usr/local/bin/node', undefined));
  });
});

describe('the macOS login item', () => {
  const launcher = { node: '/opt/homebrew/bin/node', cli: '/opt/homebrew/bin/claude-code-session-tracker' };

  it('runs a script named after the project, so Login Items shows that name', () => {
    strictEqual(
      launcherScriptPath('/Users/a'),
      '/Users/a/Library/Application Support/claude-code-session-tracker/Claude Code Session Tracker',
    );
    match(buildPlist(launcher, '/Users/a'), /<array>\n\t\t<string>\/Users\/a\/Library\/Application Support\/claude-code-session-tracker\/Claude Code Session Tracker<\/string>\n\t<\/array>/);
  });

  it('has the script become the tracker itself when it can run on its own', () => {
    strictEqual(
      buildLauncherScript(launcher, true).split('\n').at(-2),
      "exec '/opt/homebrew/bin/claude-code-session-tracker'",
    );
  });

  it('falls back to node when the tracker cannot run on its own', () => {
    strictEqual(
      buildLauncherScript(launcher, false).split('\n').at(-2),
      "exec '/opt/homebrew/bin/node' '/opt/homebrew/bin/claude-code-session-tracker'",
    );
  });

  it('quotes paths for the shell', () => {
    match(buildLauncherScript({ node: '/n', cli: "/it's here/cli.js" }, true), /exec '\/it'\\''s here\/cli\.js'/);
  });

  it('never passes --no-open, so logging in opens the page', () => {
    strictEqual(buildLauncherScript(launcher, true).includes('--no-open'), false);
  });

  it('starts at login and logs to the user Logs folder', () => {
    const plist = buildPlist(launcher, '/Users/a');
    match(plist, new RegExp(`<string>${LABEL}</string>`));
    match(plist, /<key>RunAtLoad<\/key>\n\t<true\/>/);
    match(plist, /<string>\/Users\/a\/Library\/Logs\/claude-code-session-tracker\.log<\/string>/);
  });

  it('gives the shebang a PATH that finds node', () => {
    match(buildPlist(launcher, '/Users/a'), /<string>\/opt\/homebrew\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin<\/string>/);
  });

  it('restarts only after a crash', () => {
    match(buildPlist(launcher, '/Users/a'), /<key>SuccessfulExit<\/key>\n\t\t<false\/>/);
  });

  it('escapes paths for XML', () => {
    match(buildPlist({ node: '/n/node', cli: '/a & b/cli.js' }, '/Users/a'), /\/a &amp; b/);
  });

  it('lives in the user LaunchAgents folder', () => {
    strictEqual(plistPath('/Users/a'), `/Users/a/Library/LaunchAgents/${LABEL}.plist`);
  });
});

describe('Windows', () => {
  it('starts through autostart launch, so no console stays open', () => {
    strictEqual(
      runKeyCommand({ node: 'C:\\Program Files\\nodejs\\node.exe', cli: 'C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\claude-code-session-tracker\\dist\\cli.js' }),
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\claude-code-session-tracker\\dist\\cli.js" autostart launch',
    );
  });

  it('logs under LOCALAPPDATA', () => {
    strictEqual(windowsLogPath({ LOCALAPPDATA: '/L' }), join('/L', 'claude-code-session-tracker', 'tracker.log'));
  });

  it('keeps the pid it started beside the log, so off can stop it', () => {
    strictEqual(windowsPidPath({ LOCALAPPDATA: '/L' }), join('/L', 'claude-code-session-tracker', 'tracker.pid'));
  });
});
