// 让复制 KaTeX 公式时得到 LaTeX 源码：DeepSeek 用 KaTeX 渲染公式，
// 官方没引入 copy-tex，直接复制只能拿到零散的 HTML 文本
const KATEX_VERSION = '0.16.11';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/contrib`;
const STYLE_ID = 'dscf-katex-copy-style';
const SCRIPT_ID = 'dscf-katex-copy-script';

// 注入 copy-tex 的样式和脚本；重复执行时先移除旧节点，避免热更新叠加
export function initKatexCopy() {
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(SCRIPT_ID)?.remove();

    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = `${CDN_BASE}/copy-tex.min.css`;
    document.head.appendChild(link);

    // copy-tex 自己拦截 copy 事件，动态加载的公式无需额外处理
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `${CDN_BASE}/copy-tex.min.js`;
    script.defer = true;
    document.head.appendChild(script);
}
