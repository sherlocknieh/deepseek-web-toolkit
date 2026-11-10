// 等 cond() 为真后执行 func()；先同步检查一次，避免脚本注入时页面已就绪却一直等待
export function waitFor(cond, func, timeout = 60000) {
    if (cond()) {
        func();
        return;
    }

    const observer = new MutationObserver(function() {
        if (cond()) {
            observer.disconnect();
            func();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    setTimeout(() => observer.disconnect(), timeout);
}
