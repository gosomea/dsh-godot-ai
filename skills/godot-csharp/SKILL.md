---
name: godot-csharp
description: "编写 Godot 4.7 .NET/C#：节点生命周期、导出属性、signals/events、资源释放、GDScript 互操作和构建诊断。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-csharp
verified: 2026-08-24
---

# Godot C# / .NET

- 仅在 .NET 版 Godot 和现有 C# 项目中使用；先检查 `.csproj`、目标框架与 Godot 版本。
- 生命周期函数使用 `_Ready`、`_Process`、`_PhysicsProcess`；导出属性用 `[Export]`，节点路径和资源类型保持强类型。
- Godot signals 可作为 C# events 使用；连接的 delegate 需要稳定引用，释放时避免悬空订阅。
- GodotObject 生命周期不等同纯 CLR 对象；尊重 `QueueFree`、`IsInstanceValid`、Variant 可支持类型和线程限制。
- GDScript/C# 互操作边界使用稳定的 Godot 类型、signal 和方法名，避免把复杂 CLR 泛型暴露给 GDScript。

`godot-ai` 的 `script_create/script_patch` 面向 GDScript；C# 文件优先使用工作区文件工具，并运行项目已有的 `dotnet build`。仍可通过 `godot-ai` 绑定节点属性、信号、场景并运行游戏；同时检查构建输出和 editor logs。
