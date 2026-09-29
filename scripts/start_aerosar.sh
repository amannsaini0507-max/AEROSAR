#!/usr/bin/env bash
# ==============================================================================
# PROJECT AEROSAR (SIH 2026, PS 26177)
# Autonomous Search & Rescue Drone System
# Master 1-Click Startup & Orchestration System
#
# Launches the unified, fully synchronized stack:
#   1. Webots 3D Physics & Disaster Simulation (Mavic 2 Pro drone, sensors, disaster world)
#   2. ROS 2 Middleware Graph (aerosar_sim, perception_node, fusion_node, nav_controller)
#   3. FastAPI Command Center Backend & WebSocket Bridge (port 8000)
#   4. React + Leaflet Command Center Dashboard (port 5173)
#
# Usage:
#   bash scripts/start_aerosar.sh                 # Default: Webots GUI + Full Stack
#   bash scripts/start_aerosar.sh --headless      # Headless mode (no 3D GUI window)
#   bash scripts/start_aerosar.sh --world <file>  # Launch with custom .wbt world
#   bash scripts/start_aerosar.sh --scenario <1-5># Launch official SIH test scenario
#   bash scripts/start_aerosar.sh --rebuild       # Force colcon clean & rebuild
# ==============================================================================

set -eo pipefail

# ANSI Color Codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENABLE_GUI="true"
WORLD_TARGET="aerosar_disaster_world.wbt"
SCENARIO_ID=""
LOG_LEVEL="info"
FORCE_REBUILD="false"

# ------------------------------------------------------------------------------
# CLI Argument Parsing
# ------------------------------------------------------------------------------
show_help() {
    echo -e "${BOLD}Project AEROSAR — Master 1-Click Startup System${NC}"
    echo -e "Usage: bash scripts/start_aerosar.sh [OPTIONS]\n"
    echo -e "Options:"
    echo -e "  --headless, --no-gui       Run Webots in headless mode (no 3D window)"
    echo -e "  --scenario <1-5>           Run specific SIH disaster scenario (1: Flood, 2: Fire, 3: Collapse, 4: GPS-Denied, 5: Offline)"
    echo -e "  --world <file.wbt>         Custom Webots world filename or absolute path"
    echo -e "  --rebuild                  Force complete colcon build before launch"
    echo -e "  --debug                    Set ROS 2 logging level to debug"
    echo -e "  -h, --help                 Show this help menu"
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --headless|--no-gui)
            ENABLE_GUI="false"
            shift
            ;;
        --scenario)
            SCENARIO_ID="$2"
            shift 2
            ;;
        --world)
            WORLD_TARGET="$2"
            shift 2
            ;;
        --rebuild)
            FORCE_REBUILD="true"
            shift
            ;;
        --debug)
            LOG_LEVEL="debug"
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo -e "${YELLOW}[WARN] Unknown option: $1 (ignoring)${NC}"
            shift
            ;;
    esac
done

if [[ -n "$SCENARIO_ID" ]]; then
    case "$SCENARIO_ID" in
        1) WORLD_TARGET="world_scenario_1_flood.wbt" ;;
        2) WORLD_TARGET="world_scenario_2_fire.wbt" ;;
        3) WORLD_TARGET="world_scenario_3_multi_hazard.wbt" ;;
        4) WORLD_TARGET="world_scenario_4_gps_denied.wbt" ;;
        5) WORLD_TARGET="world_scenario_5_offline.wbt" ;;
        *) echo -e "${RED}[ERROR] Invalid scenario ID: ${SCENARIO_ID} (Must be 1 to 5)${NC}"; exit 1 ;;
    esac
fi

echo -e "\n${CYAN}======================================================================${NC}"
echo -e "${BOLD}  🚁 PROJECT AEROSAR — UNIFIED 1-CLICK STARTUP SYSTEM${NC}"
echo -e "  SIH 2026 PS 26177 | AI Autonomous Emergency Search & Rescue"
echo -e "${CYAN}======================================================================${NC}"
echo -e "  Configuration: World=${BOLD}${WORLD_TARGET}${NC} | GUI=${BOLD}${ENABLE_GUI}${NC} | LogLevel=${BOLD}${LOG_LEVEL}${NC}\n"

# ------------------------------------------------------------------------------
# STEP 1: Process Cleanup (Sweep lingering processes)
# ------------------------------------------------------------------------------
echo -e "${BOLD}[1/5] Cleaning up old processes & checking network ports...${NC}"
pkill -9 -f "webots-bin" 2>/dev/null || true
pkill -9 -f "webots" 2>/dev/null || true
pkill -9 -f "ros2 launch" 2>/dev/null || true
pkill -9 -f "webots_drone_node" 2>/dev/null || true
pkill -9 -f "perception_node" 2>/dev/null || true
pkill -9 -f "fusion_node" 2>/dev/null || true
pkill -9 -f "nav_controller" 2>/dev/null || true
pkill -9 -f "bridge_node" 2>/dev/null || true
pkill -9 -f "uvicorn" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true
sleep 1.0

# Free ports 8000 and 5173 if still bound
for port in 8000 5173 1234; do
    pid=$(lsof -ti :$port 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
        kill -9 $pid 2>/dev/null || true
    fi
done
echo -e "${GREEN}✓ Ports 8000, 5173, 1234 cleared. Memory swept.${NC}\n"

# ------------------------------------------------------------------------------
# STEP 2: Environment Sourcing & Pre-Flight Dependencies
# ------------------------------------------------------------------------------
echo -e "${BOLD}[2/5] Verifying environment & runtime dependencies...${NC}"

# 1. Source ROS 2
if [[ -f "/opt/ros/humble/setup.bash" ]]; then
    source "/opt/ros/humble/setup.bash"
    echo -e "  ${GREEN}✓ ROS 2 Humble sourced: /opt/ros/humble/setup.bash${NC}"
elif [[ -f "/opt/ros/jazzy/setup.bash" ]]; then
    source "/opt/ros/jazzy/setup.bash"
    echo -e "  ${GREEN}✓ ROS 2 Jazzy sourced: /opt/ros/jazzy/setup.bash${NC}"
else
    echo -e "${RED}[ERROR] Neither ROS 2 Humble nor Jazzy found under /opt/ros! Please install ROS 2.${NC}"
    exit 1
fi

# 2. Webots Runtime Configuration (WSL2/Linux OpenGL LLVMpipe software rasterizer)
export GALLIUM_DRIVER=llvmpipe
export LIBGL_ALWAYS_SOFTWARE=1
export WEBOTS_HOME="/usr/local/webots"
export LD_LIBRARY_PATH="/usr/local/webots/lib/controller:${LD_LIBRARY_PATH:-}"
export PYTHONPATH="/usr/local/webots/lib/controller/python:${PYTHONPATH:-}"
export WEBOTS_CONTROLLER_URL="tcp://127.0.0.1:1234/Mavic 2 PRO"

# 3. Check Python Backend Dependencies
if ! python3 -c "import fastapi, uvicorn, pydantic, cv2, numpy, websockets" 2>/dev/null; then
    echo -e "${YELLOW}  Installing missing Python backend dependencies...${NC}"
    pip install -q -r "${PROJECT_ROOT}/backend/requirements.txt"
fi
echo -e "  ${GREEN}✓ Python backend requirements verified.${NC}"

# 4. Check Frontend Node Dependencies
if [[ ! -d "${PROJECT_ROOT}/frontend/node_modules" ]]; then
    echo -e "${YELLOW}  frontend/node_modules missing. Running npm install...${NC}"
    (cd "${PROJECT_ROOT}/frontend" && npm install)
fi
echo -e "  ${GREEN}✓ Frontend node_modules verified.${NC}\n"

# ------------------------------------------------------------------------------
# STEP 3: Consolidated Workspace Build
# ------------------------------------------------------------------------------
echo -e "${BOLD}[3/5] Verifying ROS 2 workspace build...${NC}"
if [[ "$FORCE_REBUILD" == "true" ]] || [[ ! -f "${PROJECT_ROOT}/install/setup.bash" ]]; then
    echo -e "  Executing: ${CYAN}colcon build --symlink-install${NC}"
    (cd "${PROJECT_ROOT}" && colcon build --symlink-install)
    echo -e "  ${GREEN}✓ Colcon build completed successfully.${NC}"
else
    echo -e "  ${GREEN}✓ Existing install artifacts verified.${NC}"
fi

source "${PROJECT_ROOT}/install/setup.bash"
echo -e "  ${GREEN}✓ Local workspace sourced: ${PROJECT_ROOT}/install/setup.bash${NC}\n"

# ------------------------------------------------------------------------------
# Signal Handlers for Clean Shutdown
# ------------------------------------------------------------------------------
FRONTEND_PID=""
ROS_PID=""
BACKEND_PID=""

cleanup() {
    echo -e "\n${YELLOW}======================================================================${NC}"
    echo -e "${BOLD}  [SHUTDOWN] Terminating all AEROSAR processes gracefully...${NC}"
    echo -e "${YELLOW}======================================================================${NC}"

    if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo -e "${DIM}  Stopping React Frontend (PID: $FRONTEND_PID)...${NC}"
        kill -INT "$FRONTEND_PID" 2>/dev/null || true
    fi

    if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo -e "${DIM}  Stopping FastAPI Backend (PID: $BACKEND_PID)...${NC}"
        kill -INT "$BACKEND_PID" 2>/dev/null || true
    fi

    if [[ -n "$ROS_PID" ]] && kill -0 "$ROS_PID" 2>/dev/null; then
        echo -e "${DIM}  Stopping ROS 2 & Webots Stack (PID: $ROS_PID)...${NC}"
        kill -INT "$ROS_PID" 2>/dev/null || true
    fi

    sleep 1.0
    pkill -9 -f "webots-bin" 2>/dev/null || true
    pkill -9 -f "webots" 2>/dev/null || true
    pkill -9 -f "uvicorn" 2>/dev/null || true
    pkill -9 -f "vite" 2>/dev/null || true
    pkill -9 -f "ros2 launch" 2>/dev/null || true

    echo -e "${GREEN}✓ All processes cleanly stopped. Bye!${NC}\n"
    exit 0
}

trap cleanup SIGINT SIGTERM

# ------------------------------------------------------------------------------
# STEP 4: Launch Webots 3D Simulation & Full ROS 2 Stack
# ------------------------------------------------------------------------------
echo -e "${BOLD}[4/5] Launching Webots Simulation & ROS 2 Stack...${NC}"
echo -e "  World Target: ${CYAN}${WORLD_TARGET}${NC} (GUI: ${ENABLE_GUI})"

ros2 launch aerosar_bringup aerosar_full_system.launch.py \
    world:="${WORLD_TARGET}" \
    enable_gui:="${ENABLE_GUI}" \
    log_level:="${LOG_LEVEL}" &
ROS_PID=$!

echo -e "  ${GREEN}✓ ROS 2 & Webots stack launched with PID: ${ROS_PID}${NC}"
echo -e "  Waiting for Webots simulation and ROS 2 nodes to discover DDS graph..."
sleep 4.0

# ------------------------------------------------------------------------------
# STEP 5: Launch FastAPI Backend & React Frontend Dashboard
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[5/5] Launching Backend Server & React Frontend Dashboard...${NC}"

# Check if bridge_node has already bound port 8000, otherwise launch standalone backend
if ! lsof -i :8000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo -e "  Starting FastAPI backend service on http://0.0.0.0:8000..."
    (cd "${PROJECT_ROOT}/backend" && python3 main.py) >/dev/null 2>&1 &
    BACKEND_PID=$!
    echo -e "  ${GREEN}✓ FastAPI server active with PID: ${BACKEND_PID}${NC}"
else
    echo -e "  ${GREEN}✓ FastAPI server active via aerosar_backend_bridge (port 8000).${NC}"
fi

# Wait for backend health endpoint
echo -e "  Verifying backend readiness at http://127.0.0.1:8000/health..."
backend_ready=false
for i in {1..12}; do
    if curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; then
        backend_ready=true
        break
    fi
    sleep 0.8
done

if [[ "$backend_ready" == "true" ]]; then
    echo -e "  ${GREEN}✓ Backend REST & WebSocket gateway verified healthy.${NC}"
else
    echo -e "  ${YELLOW}[WARN] Backend health check delayed; proceeding with launch.${NC}"
fi

# Launch React Frontend (Vite)
echo -e "  Starting React Command Center Dashboard on http://localhost:5173..."
(cd "${PROJECT_ROOT}/frontend" && npm run dev:backend -- --host 0.0.0.0 --port 5173) >/dev/null 2>&1 &
FRONTEND_PID=$!
echo -e "  ${GREEN}✓ Frontend dev server active with PID: ${FRONTEND_PID}${NC}"

sleep 2.0

# ------------------------------------------------------------------------------
# FINAL STATUS & LIVE DASHBOARD BANNER
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}======================================================================${NC}"
echo -e "${BOLD}  ★ AEROSAR FULL-STACK SYSTEM FULLY OPERATIONAL ★${NC}"
echo -e "${CYAN}======================================================================${NC}"
echo -e "  ${BOLD}🖥️  Live Dashboard:${NC}        ${CYAN}${BOLD}http://localhost:5173/${NC}"
echo -e "  ${BOLD}⚙️  Backend API & Docs:${NC}    ${CYAN}http://localhost:8000/docs${NC}"
echo -e "  ${BOLD}📡 Telemetry WebSocket:${NC}   ${CYAN}ws://localhost:8000/ws/live${NC}"
echo -e "  ${BOLD}🎮 Webots 3D Viewport:${NC}    ${CYAN}Active (PID: ${ROS_PID})${NC}"
echo -e "  ----------------------------------------------------------------------"
echo -e "  ${BOLD}Live Subsystems Synchronized:${NC}"
echo -e "    • Webots Mavic 2 Pro Drone -> /camera/image_raw & /thermal/image_raw"
echo -e "    • Perception Node (YOLOv8) -> /perception/person & /perception/hazard"
echo -e "    • Sensor Fusion Node       -> /perception/detection & Geotagging"
echo -e "    • Navigation Controller    -> /navigation/cmd_vel (Serpentine Pattern)"
echo -e "    • Backend Bridge           -> Explainable Risk Scoring & A* Safe Route"
echo -e "    • Frontend Command Center  -> Real-Time Leaflet GIS & Video Stream"
echo -e "  ----------------------------------------------------------------------"
echo -e "  Press ${RED}${BOLD}Ctrl + C${NC} anytime to stop all processes cleanly."
echo -e "${CYAN}======================================================================${NC}\n"

# Wait on background processes
wait "$ROS_PID"
