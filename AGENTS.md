# DeepSeek 网页端工具箱

DeepSeek 网页端增强油猴脚本（Vite + vite-plugin-monkey）：KaTeX 复制修正、会话文件夹、消息导航、折叠思考；导航另适配 ChatGPT / Gemini / Grok / 思畅 AI / Venice。

## 文档地图

| 要知道什么 | 去哪里 |
| --- | --- |
| 目录结构、模块职责、调试与发布机制 | `docs/README-dev.md` |
| 功能清单与安装地址 | `README.md` |
| 各站点的导航适配项 | `src/message-nav.js` 的 `SITE_ADAPTERS` |

## 开工流程

1. **定位**：先看 `docs/README-dev.md` 的对应要点，再改具体模块。
2. **实现**：取最小完整集，能改现有模块就不新增文件。
3. **验证**：`nub run build` 必须通过；站点适配用 `nub run dev` 在目标站点实测；发布脚本用 `nub run release --dry-run` 预演。
4. **记录**：机制、站点结构差异、踩坑写回 `docs/README-dev.md`。
5. **提交**：走 `nub run release "…"`，不先单独 `git commit`。

## 记忆落点

| 发生了什么 | 写到哪里 |
| --- | --- |
| 新功能或行为变化 | `docs/README-dev.md` 对应小节 |
| 机制、根因、站点 DOM 差异 | `docs/README-dev.md` 对应小节 |
| 版本号与发布流程变化 | `docs/README-dev.md` 与 `.dev/` 脚本 |

- 代码与文档同一轮完成；行为变化直接改写原条目，不留变更史。

## 自动提交

每轮对话后自行提交（除非只有单处微小细节改动）；仓库有发布脚本时走发布脚本，不先单独 `git commit`；发现会话外改动先弹框问用户如何提交。

## 维护

目录结构、命令或发布流程变化时同步更新本文件与 `docs/README-dev.md`。
