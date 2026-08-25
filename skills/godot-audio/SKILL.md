---
name: godot-audio
description: "配置 Godot 音频播放器、bus、effects、2D/3D 衰减、音乐与音效播放，并验证运行时音频状态。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-audio
verified: 2026-08-24
---

# Godot Audio

- UI/全局音乐用 `AudioStreamPlayer`，空间音效用 2D/3D 版本；播放器生命周期跟随拥有声音的对象或稳定的音频管理器。
- 至少分 Music、SFX、UI 等 bus；音量设置存 dB，用户设置可用 linear↔dB 转换。
- 音乐切换做淡入淡出；高频 SFX 需要播放器池或 polyphony，避免每次创建节点。
- 3D 声音设置合理距离、衰减和最大声道；不要让不可听见的远处声源持续占预算。
- 音频素材导入、loop 和 stream 类型属于资源事实，先读再改。

用 `audio_manage` 创建 player、设置 stream/playback、play/stop/list。运行时触发实际事件并回读播放器状态；日志验证资源可加载。听感无法从结构数据证明时明确标注仍需人工试听。
