---
name: godot-export
description: "配置和检查 Godot export preset、模板、平台权限、资源过滤、headless 构建与发布前验收。准备导出时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-export
verified: 2026-08-24
---

# Godot Export

- 导出前锁定目标平台、架构、渲染器、窗口/分辨率、权限和签名要求。
- `export_presets.cfg` 可进版本库，但签名密钥、密码和商店凭证不得提交。
- 检查 export templates 与编辑器版本匹配；自定义资源扩展名、动态加载路径和大小写在打包后尤其容易丢失。
- 发布构建禁用调试后门和开发服务器，检查日志、存档位置、首次启动、暂停/恢复和退出路径。
- 桌面、Web、移动和 headless 的限制不同；编辑器运行通过不等于导出包通过。

先读取项目设置和相关文件，使用当前仓库已有命令完成导出。`godot-ai` 用于导出前的场景、错误、测试和视觉验收；若没有平台 SDK/签名材料，只生成明确的待办，不伪造成功产物。
