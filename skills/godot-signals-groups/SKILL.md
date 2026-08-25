---
name: godot-signals-groups
description: "用 Godot signals 与 groups 设计解耦通信，连接、断开、广播并验证信号图。处理事件架构或连信号时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-signals-groups
verified: 2026-08-24
---

# Signals 与 Groups

- signal 表达“发生了什么”，不要让发送者知道所有接收者。
- 同一场景内优先直连 signal；父到子用方法调用；跨系统广播只有在确有多订阅者时才使用 EventBus autoload。
- 用 typed signal 和清晰的过去式/事件式名称，参数只携带接收方真正需要的数据。
- 动态节点在进入树后连接，在释放或替换时保证连接不会悬空；一次性流程可使用 `CONNECT_ONE_SHOT`。
- group 适合标签化查询和批量调用，不替代稳定的对象引用或类型契约。

执行时先用 `signal_manage(op="list")` 和 `node_manage(op="get_groups")` 读现状，再 connect/disconnect、add/remove group。修改后重新 list，并通过运行时交互证明事件只触发一次且目标正确。
