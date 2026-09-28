#!/usr/bin/env bash
# ==============================================================================
# AEROSAR ROS 2 Bag Recorder & Offline Playback Utility
# Member 1 — Drone Simulation & ROS 2 Lead
# SIH 2026 — Search & Rescue Project
#
# Usage:
#   ./scripts/record_demo_rosbag.sh                     # Start recording topics
#   ./scripts/record_demo_rosbag.sh --replay <bag_path> # Replay a recorded bag
# ==============================================================================

set -eo pipefail

# Text formatting
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Determine project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BAGS_DIR="${PROJECT_ROOT}/data/bags"

# Essential AEROSAR topics specified in Section 7 of Master Tech Spec
RECORD_TOPICS=(
    "/camera/image_raw"
    "/thermal/image_raw"
    "/imu/data"
    "/gps/fix"
    "/perception/detection"
    "/navigation/cmd_vel"
    "/mission/status"
    "/alerts/emergency"
)

# ------------------------------------------------------------------------------
# Help & Playback Modes
# ------------------------------------------------------------------------------
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: $0 [--replay [<bag_path>]]"
    echo "  --replay [path]  Replay latest or specified bag recording"
    echo "  --help, -h       Display this help message"
    exit 0
fi

if [[ "$1" == "--replay" ]]; then
    BAG_PATH="$2"

    if [[ -z "$BAG_PATH" ]]; then
        echo -e "${YELLOW}[ROS Bag] No bag path specified. Searching in ${BAGS_DIR}...${NC}"
        if [[ ! -d "$BAGS_DIR" ]]; then
            echo -e "${RED}[ERROR] No bags directory found at ${BAGS_DIR}${NC}"
            exit 1
        fi
        # Pick the most recently created bag directory
        BAG_PATH="$(ls -td "${BAGS_DIR}"/aerosar_demo_* 2>/dev/null | head -n 1 || true)"
        if [[ -z "$BAG_PATH" ]]; then
            echo -e "${RED}[ERROR] No recorded bags found in ${BAGS_DIR}${NC}"
            exit 1
        fi
        echo -e "${GREEN}[ROS Bag] Selecting latest recording:${NC} ${BAG_PATH}"
    fi

    if [[ ! -d "$BAG_PATH" && ! -f "$BAG_PATH" ]]; then
        echo -e "${RED}[ERROR] Bag path does not exist: ${BAG_PATH}${NC}"
        exit 1
    fi

    echo -e "${CYAN}======================================================================${NC}"
    echo -e "${BOLD}  AEROSAR — Telemetry Playback Engine${NC}"
    echo -e "  Replaying recorded ROS 2 telemetry to bypass local rendering lag"
    echo -e "  Bag Target: ${BOLD}${BAG_PATH}${NC}"
    echo -e "${CYAN}======================================================================${NC}"

    # Source ROS 2 if needed
    if ! command -v ros2 &>/dev/null; then
        if [[ -f "/opt/ros/humble/setup.bash" ]]; then
            source "/opt/ros/humble/setup.bash"
        fi
    fi

    echo -e "${GREEN}[ROS Bag] Starting playback (Press Ctrl+C to stop)...${NC}\n"
    exec ros2 bag play "$BAG_PATH" --clock 200
fi

# ------------------------------------------------------------------------------
# Recording Mode
# ------------------------------------------------------------------------------
mkdir -p "$BAGS_DIR"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_BAG="${BAGS_DIR}/aerosar_demo_${TIMESTAMP}"

echo -e "${CYAN}======================================================================${NC}"
echo -e "${BOLD}  AEROSAR — ROS 2 Demo Bag Recorder${NC}"
echo -e "  Destination: ${BOLD}${OUTPUT_BAG}${NC}"
echo -e "${CYAN}======================================================================${NC}"
echo -e "  ${BOLD}Recorded Topics:${NC}"
for topic in "${RECORD_TOPICS[@]}"; do
    echo -e "    - ${CYAN}${topic}${NC}"
done
echo -e "${CYAN}======================================================================${NC}"

# Source ROS 2 environment
if ! command -v ros2 &>/dev/null; then
    if [[ -f "/opt/ros/humble/setup.bash" ]]; then
        source "/opt/ros/humble/setup.bash"
    fi
fi
if [[ -f "${PROJECT_ROOT}/install/setup.bash" ]]; then
    source "${PROJECT_ROOT}/install/setup.bash"
fi

# Graceful termination handler
cleanup() {
    echo -e "\n${YELLOW}[ROS Bag] Interrupt received. Finalizing and closing bag cleanly...${NC}"
    if [[ -n "$RECORD_PID" ]] && kill -0 "$RECORD_PID" 2>/dev/null; then
        kill -INT "$RECORD_PID" 2>/dev/null
        wait "$RECORD_PID" 2>/dev/null || true
    fi
    echo -e "${GREEN}[ROS Bag] Bag saved successfully: ${OUTPUT_BAG}${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

echo -e "\n${GREEN}[ROS Bag] Recording active... (Press Ctrl+C to save and exit)${NC}"

# Start recording
ros2 bag record -o "$OUTPUT_BAG" "${RECORD_TOPICS[@]}" &
RECORD_PID=$!

wait "$RECORD_PID"
