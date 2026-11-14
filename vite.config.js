import path from 'node:path';
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// 调试载入器：严格 CSP 站点会拦掉 localhost 脚本。优先复用页面 script 的 nonce；
// 页面策略不含 nonce-source 时（如 Gemini），改由油猴侧取单文件包，再用页面允许的
// blob: 执行。两条路都走不通时只能手动放行 CSP
function devLoader(entrySrc, key) {
    window.GM;
    document[key] = window;

    const origin = new URL(entrySrc).origin;
    const bundleSrc = `${origin}/__dscf/dev-bundle.js`;
    const versionSrc = `${origin}/__dscf/dev-version`;
    const page = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
    const trust = page.trustedTypes
        ? page.trustedTypes.createPolicy(key, { createScriptURL: (input) => input })
        : null;
    const trusted = (url) => (trust ? trust.createScriptURL(url) : url);

    let nonceTried = false;
    let fallback = false;

    const retryWhen = (ready, run) => {
        if (ready()) return run();
        const observer = new MutationObserver(() => {
            if (!ready()) return;
            observer.disconnect();
            run();
        });
        observer.observe(document, { childList: true, subtree: true });
    };

    // 单文件包：油猴请求绕过 connect-src，blob 脚本绕过 script-src 的主机白名单
    const loadBundle = () => {
        if (fallback || typeof GM_xmlhttpRequest !== 'function') return;
        fallback = true;
        const apply = () => GM_xmlhttpRequest({
            method: 'GET',
            url: bundleSrc,
            onload: (res) => {
                if (res.status < 200 || res.status >= 300) return;
                const url = URL.createObjectURL(new Blob([res.responseText], { type: 'text/javascript' }));
                const script = document.createElement('script');
                script.src = trusted(url);
                script.onload = script.onerror = () => setTimeout(() => URL.revokeObjectURL(url), 0);
                (document.head || document.documentElement).append(script);
            }
        });
        apply();
        // 版本号变化即重新取包，补偿 CSP 站点不可用的 Vite HMR
        let last = null;
        setInterval(() => GM_xmlhttpRequest({
            method: 'GET',
            url: versionSrc,
            onload: (res) => {
                const version = res.responseText;
                if (last !== null && version !== last) apply();
                last = version;
            }
        }), 1000);
    };

    const inject = (withNonce) => {
        const parent = document.head || document.documentElement;
        // document-start 时 html 还没创建，等解析出根节点再挂载
        if (!parent) return retryWhen(() => document.head || document.documentElement, () => inject(withNonce));
        const nonce = withNonce ? (document.querySelector('script[nonce]')?.nonce || '') : '';
        const script = document.createElement('script');
        script.type = 'module';
        if (nonce) script.nonce = nonce;
        script.src = trusted(entrySrc);
        script.onerror = () => {
            if (withNonce || nonceTried) return loadBundle();
            // 先试页面 nonce；页面始终没有 nonce 时退回单文件包
            nonceTried = true;
            let found = false;
            const retry = () => { if (!found) { found = true; inject(true); } };
            retryWhen(() => document.querySelector('script[nonce]'), retry);
            setTimeout(() => { if (!found) { found = true; loadBundle(); } }, 2000);
        };
        parent.append(script);
    };
    inject(false);
}

function devCspNonce() {
    return {
        name: 'dscf-dev-csp-nonce',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url?.split('?')[0] !== '/__vite-plugin-monkey.install.user.js') return next();
                const end = res.end.bind(res);
                res.end = (chunk, ...args) => {
                    const text = typeof chunk === 'string' ? chunk : chunk?.toString?.('utf8');
                    const call = text?.match(/\}\)\("([^"]+)",\s*"([^"]+)"\);\s*$/);
                    const start = call ? text.indexOf(';((entrySrc, key) => {') : -1;
                    if (start >= 0) {
                        chunk = text.slice(0, start)
                            + `;(${devLoader.toString()})(${JSON.stringify(call[1])},${JSON.stringify(call[2])});\n`;
                    } else if (text) {
                        console.warn('[dscf] 未识别 Vite 调试载入器结构，CSP 站点可能需要手动放行');
                    }
                    return end(chunk, ...args);
                };
                next();
            });
        }
    };
}

// 单文件调试包：CSP 站点加载不了 localhost 模块时，载入器用油猴请求取这份 IIFE，
// 再以页面允许的 blob: 执行；源码变动会更新版本号，载入器轮询后自动重新取包
function devBundle() {
    let version = 0;
    let cached = null;
    let building = null;

    const bundle = async (root, atVersion) => {
        const { rolldown } = await import('rolldown');
        const build = await rolldown({
            input: path.join(root, 'src/main.js'),
            plugins: [{
                name: 'dscf-gm-shim',
                resolveId(id) { if (id === '$') return '\0dscf-gm-shim'; },
                load(id) {
                    if (id === '\0dscf-gm-shim') {
                        return "export const unsafeWindow = typeof globalThis.unsafeWindow !== 'undefined' ? globalThis.unsafeWindow : window;";
                    }
                }
            }]
        });
        try {
            const { output } = await build.generate({ format: 'iife' });
            return { version: atVersion, code: output.find(item => item.type === 'chunk').code };
        } finally {
            await build.close();
        }
    };

    return {
        name: 'dscf-dev-bundle',
        apply: 'serve',
        configureServer(server) {
            const srcDir = path.join(server.config.root, 'src') + path.sep;
            server.watcher.on('all', (event, file) => {
                if (file.startsWith(srcDir)) version += 1;
            });

            server.middlewares.use(async (req, res, next) => {
                const url = req.url?.split('?')[0];
                if (url === '/__dscf/dev-version') {
                    res.setHeader('content-type', 'text/plain');
                    return res.end(String(version));
                }
                if (url !== '/__dscf/dev-bundle.js') return next();
                try {
                    if (!cached || cached.version !== version) {
                        building ??= bundle(server.config.root, version).finally(() => { building = null; });
                        cached = await building;
                    }
                    res.setHeader('content-type', 'application/javascript');
                    res.end(cached.code);
                } catch (err) {
                    res.statusCode = 500;
                    res.end(String(err?.stack || err));
                }
            });
        }
    };
}

// 开发：npm run dev 后把终端里的 dev 版 userscript 装进油猴，改代码自动热更新
// 构建：npm run build 直接覆盖 dist 下的发布文件，保持 README 安装链接不变
// 版本号：由 .dev/bump-and-build.mjs 按日期时间写入，不要手改
export default defineConfig({
  plugins: [
    devCspNonce(),
    devBundle(),
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: 'DeepSeek 网页端工具箱 - LaTeX 公式复制 & 会话文件夹 & 消息导航 & 折叠思考',
        namespace: 'http://tampermonkey.net/',
        version: '2026.11.14.1626',
        description: '增强 DeepSeek 网页端使用体验: 会话文件夹 + 消息导航 + KaTeX 公式复制修正 + 默认折叠思考。',
        author: 'sherlocknieh',
        match: [
            'https://chat.deepseek.com/*',
            'https://chatgpt.com/*',
            'https://chat.openai.com/*',
            'https://gemini.google.com/*',
            'https://grok.com/*'
        ],
        icon: 'https://www.deepseek.com/favicon.ico',
        license: 'MIT',
        downloadURL: 'https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js',
        updateURL: 'https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js',
        grant: ['GM_setValue', 'GM_getValue'],
        // 导航断点必须在应用初始化前改写，否则导航已被卸载
        'run-at': 'document-start',
      },
      build: {
        fileName: 'deepseek-web-toolkit.user.js',
        metaFileName: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
  },
});
