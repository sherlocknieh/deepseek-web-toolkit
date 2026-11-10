// 真机调试用 CDP 客户端：在 chat.deepseek.com 页面里求值、模拟输入、抓控制台/网络、截图
//
// 前置：用复制出来的登录态配置启动 Chrome（见 AGENTS.md「浏览器调试」），
// 端口默认 9337，可用环境变量 CDP_PORT 覆盖。
//
// 用法：
//   node tools/browser-debug.mjs eval <file.js>       在页面里执行文件内容并输出返回值
//   node tools/browser-debug.mjs shot <out.png>       截当前页面
//   node tools/browser-debug.mjs key Enter|Escape     发送按键，等 2.5s 后输出网络日志
//   node tools/browser-debug.mjs type <text>          在聚焦的输入框里输入文本
//   node tools/browser-debug.mjs net [ms]             刷新页面并等待，抓 /api/v0/ 请求与响应
//   node tools/browser-debug.mjs close                关闭浏览器
//
// 注意：页面里的脚本日志和网络日志在命令结束后统一打印，带 CONSOLE 前缀。
const PORT = process.env.CDP_PORT || 9337;

async function pageTarget() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.url.includes('chat.deepseek.com'));
}

class Client {
    constructor(ws) {
        this.ws = ws;
        this.id = 0;
        this.pending = new Map();
        this.requests = new Map();
        this.logs = [];
        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
                return;
            }
            if (msg.method === 'Runtime.consoleAPICalled') {
                const text = msg.params.args.map(a => a.value ?? a.description ?? a.type).join(' ');
                this.logs.push(`[${msg.params.type}] ${text}`);
            }
            if (msg.method === 'Runtime.exceptionThrown') {
                this.logs.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description || ''}`);
            }
            if (msg.method === 'Network.requestWillBeSent' && msg.params.request.url.includes('/api/v0/')) {
                this.requests.set(msg.params.requestId, {
                    url: msg.params.request.url,
                    method: msg.params.request.method
                });
                this.logs.push(`[net] ${msg.params.request.method} ${msg.params.request.url} ${msg.params.request.postData || ''}`);
            }
            if (msg.method === 'Network.loadingFinished' && this.requests.has(msg.params.requestId)) {
                const info = this.requests.get(msg.params.requestId);
                this.requests.delete(msg.params.requestId);
                this.send('Network.getResponseBody', { requestId: msg.params.requestId })
                    .then(res => {
                        const body = res.base64Encoded ? Buffer.from(res.body, 'base64').toString() : res.body;
                        this.logs.push(`[body] ${info.url} ${body.slice(0, 1500)}`);
                    })
                    .catch(() => {});
            }
        });
    }

    send(method, params = {}) {
        const id = ++this.id;
        this.ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }

    async evaluate(expression) {
        const res = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
        });
        if (res.exceptionDetails) {
            throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
        }
        return res.result.value;
    }
}

const target = await pageTarget();
if (!target) {
    console.error('没有找到 chat.deepseek.com 页面');
    process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
});

const client = new Client(ws);
await client.send('Runtime.enable');
await client.send('Network.enable');

const [mode, arg] = process.argv.slice(2);

if (mode === 'eval') {
    const fs = await import('node:fs');
    const code = fs.readFileSync(arg, 'utf8');
    try {
        const value = await client.evaluate(code);
        console.log(JSON.stringify(value, null, 2));
    } catch (err) {
        console.error('EVAL ERROR:', err.message);
    }
} else if (mode === 'shot') {
    const fs = await import('node:fs');
    const res = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(arg, Buffer.from(res.data, 'base64'));
    console.log('saved', arg);
} else if (mode === 'key') {
    const map = { Escape: 27, Enter: 13, Backspace: 8 };
    const vk = map[arg] || 0;
    const base = { key: arg, code: arg, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await new Promise(resolve => setTimeout(resolve, 2500));
    console.log('key', arg);
} else if (mode === 'type') {
    await client.send('Input.insertText', { text: arg });
    console.log('typed', arg);
} else if (mode === 'net') {
    await client.send('Page.enable');
    await client.send('Page.reload', { ignoreCache: false });
    await new Promise(resolve => setTimeout(resolve, Number(arg) || 8000));
    console.log('net done');
} else if (mode === 'close') {
    await client.send('Browser.close');
    console.log('closed');
}

client.logs.forEach(line => console.log('CONSOLE', line));
ws.close();
