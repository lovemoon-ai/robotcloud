# 任务文档

## 1. 任务概述

清理 RobotCloud Desktop 的 SO101 页面加载入口，避免 Desktop 在 Debug 默认配置或 `ROBOTCLOUD_DESKTOP_URL` 环境变量下加载远程 `/so101` 页面。

当前仍需保留云端 `/so101` 导航拦截保护逻辑：当 WebView 导航到 `https://robotcloud.conductor-ai.top/so101` 时，自动跳回本地内置 SO101 页面。

## 2. 目标与成功定义

**主要目标：**
- Desktop 默认只加载本地内置 SO101 页面。
- 移除 Debug 默认加载本机 dev server `http://127.0.0.1:6151/so101/` 的行为。
- 移除 `ROBOTCLOUD_DESKTOP_URL` 让 Desktop 加载任意外部 URL 的入口。
- 保留 `is_cloud_so101_url` 及 `on_navigation` 中将云端 `/so101` 拦截回本地页面的保护逻辑。

**成功标准：**
- Release 和 Debug 默认启动都进入本地内置 SO101 页面。
- 设置 `ROBOTCLOUD_DESKTOP_URL=https://robotcloud.conductor-ai.top/so101/` 不会让 Desktop 初始加载远程 SO101 页面。
- 点击或导航到 `https://robotcloud.conductor-ai.top/so101` 仍会被拦截并跳回本地 SO101 页面。

## 3. 范围

**包含范围：**
- 修改 `desktop/src-tauri/src/lib.rs` 中的启动 URL 决策逻辑：
  - `default_web_url`
  - `web_url`
  - `initial_webview_url`
- 更新或新增相关 Rust 单测。
- 如测试中依赖 Debug 默认 URL，调整为本地内置 SO101 的预期。

**不包含范围：**
- 不移除云端其他页面的访问能力。
- 不改前端 `desktopAwareHref` 的云端跳转策略，除非实现时发现与目标行为冲突。
- 不改 Volc 部署逻辑。
- 不改 SO101 runtime prepare、terminal、record 等业务功能。

## 4. 输入

- 当前代码路径：`desktop/src-tauri/src/lib.rs`
- 当前 Debug 默认 URL：`http://127.0.0.1:6151/so101/`
- 当前本地内置页面：`so101/index.html`
- 当前保护逻辑：`is_cloud_so101_url` 和 WebView `on_navigation`

## 5. 预期输出

- 一组代码修改，使 Desktop 初始加载不再依赖远程或 dev server SO101。
- 一组测试修改，覆盖：
  - 默认启动 URL
  - `ROBOTCLOUD_DESKTOP_URL` 不再作为外部 SO101 初始加载入口
  - 云端 `/so101` 导航拦截仍有效

## 6. 约束与假设

**约束：**
- 只保留云端 `/so101` 的导航拦截保护逻辑，不保留主动加载远程 `/so101` 的入口。
- 不影响 release app 对本地打包 `so101/index.html` 的加载。

**假设：**
- Desktop 开发时如需调试前端，应通过其他明确开发命令或临时改动实现，不再作为 Tauri Debug 默认行为。
- `ROBOTCLOUD_DESKTOP_URL` 当前没有不可替代的生产用途。

## 7. 执行计划

1. 检查 `default_web_url`、`web_url`、`initial_webview_url` 的调用方。
2. 将 Debug 和 Release 默认入口统一为本地内置 `LOCAL_SO101_APP_PATH`。
3. 移除或限制 `ROBOTCLOUD_DESKTOP_URL` 对初始 WebView 外部 URL 的覆盖能力。
4. 保留 `is_cloud_so101_url` 与 `on_navigation` 拦截逻辑。
5. 更新 Rust 单测中关于 Debug 默认 URL 的断言。
6. 运行 `cargo test --manifest-path desktop/src-tauri/Cargo.toml`。

## 8. 验收标准

- [ ] `cargo test --manifest-path desktop/src-tauri/Cargo.toml` 通过。
- [ ] Debug 默认启动不再使用 `http://127.0.0.1:6151/so101/`。
- [ ] `ROBOTCLOUD_DESKTOP_URL` 不能让 Desktop 初始加载远程 `/so101`。
- [ ] `https://robotcloud.conductor-ai.top/so101` 导航仍会被拦截回本地 SO101 页面。
- [ ] Release 默认仍加载本地内置 `so101/index.html`。

## 9. 风险与待澄清问题

**风险：**
- 如果已有开发流程依赖 Debug 默认 dev server，需要补充新的显式开发入口。
- 如果 `ROBOTCLOUD_DESKTOP_URL` 被用于烟测或特殊环境，需要先迁移这些调用。

**待澄清问题：**
- 是否需要保留一个仅开发用、名称更明确的环境变量，例如 `ROBOTCLOUD_DESKTOP_DEV_URL`，并且只在 debug build 中生效？
