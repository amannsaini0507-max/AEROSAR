#!/usr/bin/env bash
# ==============================================================================
# AEROSAR Master Demo Pipeline & Presentation Execution Script
# Member 1 — Drone Simulation & ROS 2 Lead
# SIH 2026 — Search & Rescue Project
#
# Execution Pipeline:
#   1. Clean up lingering Webots and ROS 2 processes
#   2. Source ROS 2 Humble & local workspace environment
#   3. Execute pre-flight system integrity and diagnostics audit
#   4. Launch full system stack (aerosar_full_system.launch.py)
#   5. Automatically trigger background ROS bag telemetry recording
#   6. Verify live publishing rates with diagnostic dashboard
#
# Usage:
#   ./scripts/run_demo_pipeline.sh                      # Standard live demo (GUI enabled)
#   ./scripts/run_demo_pipeline.sh --headless           # Headless / CI mode (no 3D GUI)
#   ./scripts/run_demo_pipeline.sh --scenario 2         # Launch specific scenario (1-5)
# ==============================================================================

set -eo pipefail

# ANSI Color Codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENABLE_GUI="true"
SCENARIO_ID="1"
LOG_LEVEL="info"

# Parse CLI flags
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
        --debug)
            LOG_LEVEL="debug"
            shift
            ;;
        *)
            echo -e "${YELLOW}Unknown option: $1 (ignoring)${NC}"
            shift
            ;;
    esac
done

echo -e "\n${CYAN}======================================================================${NC}"
echo -e "${BOLD}  🛸 AEROSAR — MASTER PRESENTATION & LIVE DEMO PIPELINE${NC}"
echo -e "  Member 1 (Drone Sim & ROS 2 Lead) | SIH 2026 PS 26177"
echo -e "${CYAN}======================================================================${NC}"
echo -e "  Configuration: GUI=${BOLD}${ENABLE_GUI}${NC} | Scenario=${BOLD}${SCENARIO_ID}${NC} | LogLevel=${BOLD}${LOG_LEVEL}${NC}\n"

# ------------------------------------------------------------------------------
# STEP 1: Process Cleanup
# ------------------------------------------------------------------------------
echo -e "${BOLD}[1/5] Cleaning up lingering Webots and ROS 2 processes...${NC}"
pkill -9 -f "webots-bin" 2>/dev/null || true
pkill -9 -f "webots" 2>/dev/null || true
pkill -9 -f "ros2 launch" 2>/dev/null || true
pkill -9 -f "webots_drone_node" 2>/dev/null || true
pkill -9 -f "perception_node" 2>/dev/null || true
pkill -9 -f "fusion_node" 2>/dev/null || true
pkill -9 -f "nav_controller" 2>/dev/null || true
pkill -9 -f "bridge_node" 2>/dev/null || true
sleep 1.0
echo -e "${GREEN}✓ Process sweep complete. Ports and memory cleared.${NC}\n"

# ------------------------------------------------------------------------------
# STEP 2: Environment Sourcing
# ------------------------------------------------------------------------------
echo -e "${BOLD}[2/5] Sourcing ROS 2 and workspace environment...${NC}"
if [[ -f "/opt/ros/humble/setup.bash" ]]; then
    source "/opt/ros/humble/setup.bash"
elif [[ -f "/opt/ros/jazzy/setup.bash" ]]; then
    source "/opt/ros/jazzy/setup.bash"
else
    echo -e "${YELLOW}[WARN] Default ROS 2 /opt/ros path not found. Proceeding with existing environment.${NC}"
fi

if [[ -f "${PROJECT_ROOT}/install/setup.bash" ]]; then
    source "${PROJECT_ROOT}/install/setup.bash"
    echo -e "${GREEN}✓ Local workspace environment sourced: ${PROJECT_ROOT}/install/setup.bash${NC}\n"
else
    echo -e "${RED}[ERROR] install/setup.bash not found! Build workspace with colcon build first.${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# STEP 3: Pre-Flight Health Check
# ------------------------------------------------------------------------------
echo -e "${BOLD}[3/5] Running pre-flight workspace integrity check...${NC}"
python3 "${SCRIPT_DIR}/system_health_check.py"
echo -e "${GREEN}✓ Pre-flight integrity verified.${NC}\n"

# ------------------------------------------------------------------------------
# Signal Handlers for Clean Shutdown
# ------------------------------------------------------------------------------
cleanup() {
    echo -e "\n${YELLOW}======================================================================${NC}"
    echo -e "${BOLD}  [DEMO PIPELINE] Shutting down all demo processes gracefully...${NC}"
    echo -e "${YELLOW}======================================================================${NC}"

    if [[ -n "$BAG_PID" ]] && kill -0 "$BAG_PID" 2>/dev/null; then
        echo -e "${DIM}  Stopping ROS bag recorder (PID: $BAG_PID)...${NC}"
        kill -INT "$BAG_PID" 2>/dev/null || true
        wait "$BAG_PID" 2>/dev/null || true
    fi

    if [[ -n "$LAUNCH_PID" ]] && kill -0 "$LAUNCH_PID" 2>/dev/null; then
        echo -e "${DIM}  Stopping ROS 2 launch system (PID: $LAUNCH_PID)...${NC}"
        kill -INT "$LAUNCH_PID" 2>/dev/null || true
        wait "$LAUNCH_PID" 2>/dev/null || true
    fi

    pkill -f "webots" 2>/dev/null || true
    echo -e "${GREEN}✓ Demo pipeline shut down successfully.${NC}\n"
    exit 0
}

trap cleanup SIGINT SIGTERM

# ------------------------------------------------------------------------------
# STEP 4: Launch Master System Stack
# ------------------------------------------------------------------------------
echo -e "${BOLD}[4/5] Launching full AEROSAR system stack (Scenario ${SCENARIO_ID})...${NC}"
ros2 launch aerosar_bringup aerosar_scenario_runner.launch.py \
    scenario_id:="${SCENARIO_ID}" \
    enable_gui:="${ENABLE_GUI}" \
    log_level:="${LOG_LEVEL}" &
LAUNCH_PID=$!

echo -e "${GREEN}✓ System launch initialized with PID: ${LAUNCH_PID}${NC}"
echo -e "  Waiting 4 seconds for simulation world and DDS graph discovery..."
sleep 4.0

# ------------------------------------------------------------------------------
# STEP 5: Trigger Background ROS Bag Recording
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[5/5] Triggering automated background ROS bag recording...${NC}"
"${SCRIPT_DIR}/record_demo_rosbag.sh" &
BAG_PID=$!
echo -e "${GREEN}✓ ROS bag recorder active in background with PID: ${BAG_PID}${NC}\n"

# Run topic verification diagnostic dashboard
sleep 2.0
echo -e "${BOLD}Running live ROS 2 topic & rate diagnostics:${NC}"
python3 "${SCRIPT_DIR}/verify_system_topics.py" --duration 3.0 || true

echo -e "\n${CYAN}======================================================================${NC}"
echo -e "${BOLD}  ★ AEROSAR DEMO PIPELINE FULLY OPERATIONAL ★${NC}"
echo -e "  - Full system nodes active: Sim, Perception, Fusion, Nav, Bridge"
echo -e "  - Background ROS bag recording active in data/bags/"
echo -e "  - Use ${CYAN}python3 scripts/sim_triggers.py${NC} in another terminal for live injects"
echo -e "  - Press ${RED}Ctrl+C${NC} anytime to stop recording and shut down cleanly"
echo -e "${CYAN}======================================================================${NC}\n"

# Keep script running and wait for user interruption
wait "$LAUNCH_PID"
