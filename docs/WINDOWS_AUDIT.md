# Windows Migration & Platform Compatibility Audit

This document records all platform-specific incompatibilities identified in the legacy codebase, along with the implemented cross-platform remediation.

| File | Line(s) | Identified Issue | Cross-Platform Remediation |
|---|---|---|---|
| `scripts/run_demo_pipeline.sh` | 1-177 | Bash script execution, Linux `pkill -9 -f`, hardcoded `/opt/ros/humble/setup.bash` | Replaced launcher with Node.js stdlib launcher `scripts/start_aerosar.js` and PowerShell wrapper `scripts/start_aerosar.ps1`. Used `taskkill /PID <pid> /T /F` on Windows and `process.kill(-pid)` on POSIX. |
| `scripts/record_demo_rosbag.sh` | 1-136 | Bash-only ROS 2 bag recorder script using `date`, `ls -td`, and Linux shell traps | Built cross-platform mission replay storage and logger in SQLite (`data/aerosar.db`) and Python/Node runners. |
| `scripts/test_all_scenarios_member1.py` | 46-47, 201-202 | Hardcoded `subprocess.run(["pkill", "-9", ...])` causes `FileNotFoundError` on Windows | Replaced with cross-platform process termination helper using `taskkill` on Windows and `pkill` on Linux. |
| `scripts/test_all_scenarios_member1.py` | 54-58 | Hardcoded paths `/usr/local/webots/...`, `python3.10`, and `/opt/ros/humble` | Updated to resolve paths using `pathlib.Path`, `sys.executable`, and environment variable detection. |
| `src/aerosar_sim/aerosar_sim/webots_drone_node.py` | 456, 465 | Relies on `ss -tulpn \| grep webots-bin` and `/proc/net/tcp` for port discovery | Replaced with standard Python `socket.create_connection` TCP probing across candidate ports `(1234, 1235, 1236, 1237)`. |
| `backend/app/main.py` | 64 | Hardcoded SQLite path defaulting to root `aerosar.db` without WAL mode | Migrated to `pathlib.Path("data") / "aerosar.db"` with automatic directory creation and `PRAGMA journal_mode=WAL;`. |
| `backend/app/main.py` | 121-418 | Direct import attempt for `rclpy` crashes if ROS 2 is not installed on Windows | Wrapped in optional import block; falls back to pure-Python `STANDALONE` simulation mode and reports mode via `/health` and `/api/health`. |
| `frontend/src/components/MapPanel.tsx` | 45-50 | Remote CDN tile URLs (`https://{s}.basemaps.cartocdn.com/...`) requiring active internet | Replaced with local procedural Canvas `GridLayer` basemap rendering a dark coordinate grid directly in browser canvas. |
| `frontend/src/components/MapPanel.tsx` | 39 | SVG element `<svg viewBox="...">` for drone icon violates Zero-SVG requirement | Converted drone marker to HTML Canvas sprite / CSS rendering. Initialized Leaflet with `preferCanvas: true`. |
| `frontend/src/components/icons.tsx` | 1-126 | Entire icon library implemented with SVG vector elements `<svg>` | Replaced with HTML Canvas procedural rendering and CSS vector shapes. |
| `frontend/src/components/VideoFeed.tsx` | 52, 93 | Illustrative scene and placeholder using `<svg>` elements | Replaced with Canvas-based procedural HUD and WebGL Three.js render-target. |
| Repository Root | All | Line-ending CRLF vs LF churning between Windows Git and Linux Git | Added `.gitattributes` enforcing `* text=auto eol=lf` across all files. |
