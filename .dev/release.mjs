#!/usr/bin/env node
/**
 * 发布脚本: 升版本号并构建，然后把源码、配置和产物放进同一个提交并打标签。
 *
 * 用法:
 *   npm run release "feat: 支持 xxx"        # 发布
 *   npm run release "fix: 修复 xxx" --push  # 发布并推送分支与标签
 *   npm run release --dry-run               # 只打印将要使用的版本号
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUMP_SCRIPT = path.join(root, '.dev/bump-and-build.mjs');
const DIST_PATH = path.join(root, 'dist/deepseek-web-toolkit.user.js');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
const push = flags.has('--push');
const dryRun = flags.has('--dry-run');
const message = argv
    .filter((arg) => !arg.startsWith('--'))
    .join(' ')
    .trim();

function run(command, args, description) {
    console.log(`\n▶ ${description}`);
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${description} 失败 (退出码 ${result.status})`);
}

const node = process.platform === 'win32' ? 'node.exe' : 'node';
run(node, [BUMP_SCRIPT, ...(dryRun ? ['--dry-run'] : [])], '生成版本号并构建');
if (dryRun) {
    console.log('\n(dry-run) 未做任何修改');
    process.exit(0);
}

// 版本号以构建产物头部为准，提交信息与标签都用它
const version = readFileSync(DIST_PATH, 'utf8').match(/\/\/ @version\s+(\S+)/)?.[1];
if (!version) {
    console.error('未能从构建产物读取 @version');
    process.exit(1);
}

const subject = message || `chore: 发布版本 ${version}`;
const commitMessage = subject.includes(version) ? subject : `${subject}\n\n发布版本: ${version}`;

try {
    run('git', ['add', '-A'], '暂存改动 (git add -A)');
    // --no-verify：版本号已在本脚本里升过，避免 pre-commit 钩子再升一次导致标签对不上
    run('git', ['commit', '--no-verify', '-m', commitMessage], `提交 (${subject})`);
    run('git', ['tag', `v${version}`], `创建标签 v${version}`);

    if (push) {
        run('git', ['push', 'origin', 'HEAD', '--tags'], '推送分支与标签 (git push)');
    }
} catch (error) {
    console.error(`\n✗ 发布失败: ${error.message}`);
    process.exit(1);
}

console.log(`\n✓ 发布完成: ${version}`);
if (!push) console.log('提示: 使用 --push 可自动推送分支与标签。');
