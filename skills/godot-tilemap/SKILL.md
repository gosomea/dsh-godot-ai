---
name: godot-tilemap
description: "使用 Godot 4.7 TileMapLayer/TileSet 构建 2D 地图：atlas、terrain、碰撞、导航、自定义数据和批量单元格编辑。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-tilemap
verified: 2026-08-24
---

# TileMapLayer 与 TileSet

- Godot 4.3+ 使用 `TileMapLayer`，不要新建已弃用的 `TileMap`。
- 地形、装饰、碰撞和导航拆分为不同 layer；明确 z-index、y-sort 与 collision layer/mask。
- 修改前读取 atlas tile 列表和图像信息，不猜 source id、atlas 坐标或 alternative tile。
- terrain 适合自动拼接；程序生成地图必须保存 seed，并把逻辑网格与视觉 tile 解耦。
- 自定义 tile data 用于语义（伤害、地表类型、代价），不要从贴图坐标反推游戏规则。

用 `tileset_manage` 发现 atlas，再用 `tilemap_manage` 设置单元、矩形批量填充、读取 used cells 或清空。每批后回读目标区域；运行时检查碰撞/导航，并用 2D viewport 或 game 截图确认接缝和层级。
