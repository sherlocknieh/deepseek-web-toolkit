#!/usr/bin/env node
/**
 * 把 vite.config.js 的版本号改成当前日期时间并重新构建。
 *
 * 版本号格式 YYYY.MM.DD.HHmm (本地时间)，同一分钟内重复执行或系统时间回拨时
 * 顺延到更大的分钟，保证始终递增。git 提交前钩子和发布脚本共用这一步。
 *
 * 参数: --dry-run 只打印将要使用的版本号
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(root, 'vite.config.js');
const DIST_PATH = path.join(root, 'dist/deepseek-web-toolkit.user.js');
const VERSION_PATTERN = /(userscript:\s*\{[\s\S]*?version:\s*')([^']+)(')/;

const dryRun = process.argv.includes('--dry-run');

const pad = (value) => String(value).padStart(2, '0');

// 本地时间拼成 YYYY.MM.DD.HHmm，便于按发布顺序比较
function formatVersion(date) {
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        `${pad(date.getHours())}${pad(date.getMinutes())}`,
    ].join('.');
}

// 逐段比较版本号，缺位按 0 处理
function compareVersions(a, b) {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const x = left[i] ?? 0;
        const y = right[i] ?? 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

const configSource = readFileSync(CONFIG_PATH, 'utf8');
const matched = configSource.match(VERSION_PATTERN);
if (!matched) {
    console.error('未能在 vite.config.js 中找到 userscript.version');
    process.exit(1);
}

const previousVersion = matched[2];
const now = new Date();
let version = formatVersion(now);
while (compareVersions(version, previousVersion) <= 0) {
    now.setMinutes(now.getMinutes() + 1);
    version = formatVersion(now);
}

console.log(`当前版本: ${previousVersion}`);
console.log(`新版本: ${version}`);
if (dryRun) {
    process.exit(0);
}

writeFileSync(
    CONFIG_PATH,
    configSource.replace(VERSION_PATTERN, (_match, prefix, _version, suffix) => `${prefix}${version}${suffix}`),
);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log('\n▶ 构建产物 (npm run build)');
const built = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) {
    writeFileSync(CONFIG_PATH, configSource);
    console.error('\n✗ 构建失败，已还原 vite.config.js');
    process.exit(built.status ?? 1);
}

// 产物头部版本号必须与配置一致，避免发布出旧版本
const distVersion = readFileSync(DIST_PATH, 'utf8').match(/\/\/ @version\s+(\S+)/)?.[1];
if (distVersion !== version) {
    writeFileSync(CONFIG_PATH, configSource);
    console.error(`\n✗ 构建产物版本号不一致: 期望 ${version}, 实际 ${distVersion}`);
    process.exit(1);
}

console.log(`\n✓ 版本 ${version} 就绪`);
