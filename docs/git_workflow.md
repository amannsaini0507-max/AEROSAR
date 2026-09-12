# AEROSAR — Member 6 Git Workflow & Governance Guide

> **Owner:** Member 6 (Git Gatekeeper & Integration Lead)

---

## 1. Branching Strategy

```text
feature/*
    ↓
develop  (Integration Branch — continuous merges)
    ↓  (Day 12 Integration Test Gate)
main     (Stable Demo-Ready Release)
```

### Team Branch Map
* `feature/webots` — Member 1 (Drone & Simulator)
* `feature/ai` — Member 2 (Perception & Fusion)
* `feature/navigation` — Member 3 (Search & Obstacle Avoidance)
* `feature/backend` — Member 4 (FastAPI, SQLite, Risk Scoring, Sync)
* `feature/dashboard` — Member 5 (React UI)
* `feature/integration` — Member 6 (Launch, Scripts, Test Infrastructure)

---

## 2. Commit Message Standard

All commits must follow the tag format:
```text
[<module>] <short action description>
```
* **Examples:**
  * `[perception] add confidence threshold filter to person detector`
  * `[backend] implement SQLite offline queue schema`
  * `[launch] add combined system launch file aerosar_system.launch.py`

---

## 3. Pull Request & Merge Policy

1. **`main` Protection:** No direct pushes to `main`. Only Member 6 merges into `main` after Day 12 integration testing passes.
2. **`develop` Policy:** Team members create PRs into `develop` when feature sub-modules are ready for integration.
3. **Interface Check:** Before merging into `develop`, verify that ROS 2 topic names and message formats strictly match [`docs/topic_interface_spec.md`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/docs/topic_interface_spec.md).

---

## 4. Issue Labels & Milestones

* `scope:l1-mvp` — Minimum Working Prototype (due Day 6)
* `scope:l2-sih` — Strong SIH Prototype (due Day 11)
* `scope:l3-stretch` — Optional Stretch Goals (SLAM, Safe Route)
* `priority:blocker` — Demo-blocking issue (must fix immediately)
