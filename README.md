# Great Wall Beian (长城备案)

**严格的代码合规性审核工具，确保每一个元素都经过合法备案。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-1.0.0-blue.svg)](https://marketplace.visualstudio.com/)

## 📖 简介

**Great Wall Beian** 是一款致力于“代码安全与合规”的 VS Code 扩展。它建立了一套严格的元素准入机制：在您的源代码中，所有元素都必须在本地的 `beian.json` 文件中进行备案。

**未备案，不准运行！** 任何未备案的元素都将被标记为严重的红色错误（Error），从而在视觉和逻辑上拦截您的开发流程，确保代码库的每一项资产都处于监管之下。

---

## ✨ 核心特性

-   **🛡️ 实时合规扫描**：自动识别代码中所有未被备案的元素。
-   **🚫 编译级拦截**：未备案元素将直接触发最高级别的 Diagnostic Error（红色波浪线），模拟“拦截编译/运行”的效果。
-   **⚡ 快速备案 (Quick Fix)**：点击灯泡图标，即可一键将未备案元素添加至 `beian.json`。
-   **📂 灵活的审核范围**：
    -   **项目模式**：优先读取工作区根目录下的 `beian.json`。
    -   **单文件模式**：在无工作区的情况下，自动寻找文件同级目录下的备案配置文件。
-   **🔄 自动同步更新**：修改 `beian.json` 后，代码错误会立即自动消除。

---

## 🛠️ 配置要求

插件核心依赖于 `beian.json` 文件。如果该文件不存在，插件会自动在备案时为您创建。

**配置文件格式示例：**

```json
{
    "registeredTypes": [
        "String",
        "Object",
        "Array",
        "MyCustomClass",
        "DatabaseConnection"
    ]
}
```

---

## 🚀 如何使用

1.  **安装插件**后打开任何代码文件。
    - 从VSC插件市场里面搜索 “`greatwallbeian`”
    - 从[Release](https://github.com/higashitaniyume/greatwallbeian/releases)下载vsix文件
2.  **发现冲突**：如果代码中出现了未备案的大写元素（例如 `UserAccount`），它会立即变红并显示：
    > `元素 "UserAccount" 未备案！编译/运行已拦截，请先完成备案。`
3.  **完成备案**：
    -   将光标移至红线处，点击出现的**黄色灯泡**。
    -   选择 `✨ 立即为 "UserAccount" 备案`。
4.  **合规通过**：插件会自动更新 `beian.json`，红线瞬间消失，代码恢复合规。

---

## ⌨️ 常用命令

| 命令 | 描述 |
| :--- | :--- |
| `GreatWall Beian: 立即执行合规扫描` | 强制重新扫描当前打开的文档。 |

---

## 🔍 原理解析

插件通过正则表达式监听文档变化。每当您输入一个新类型时，它会去匹配 `beian.json` 里的 `registeredTypes` 列表。
-   **匹配成功**：安全，放行。
-   **匹配失败**：拦截，标记为 `MUST_FILED` 错误。

---

## ⚠️ 注意事项

*   本插件默认排除对 `beian.json` 本身的扫描，防止出现“自我审计”循环。
*   建议将 `beian.json` 提交至您的 Git 仓库，以便团队成员共享备案状态。

---

**安全第一，代码合规，从 Great Wall Beian 开始。**
