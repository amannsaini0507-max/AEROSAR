# AEROSAR — AI-Enabled Autonomous Emergency Search and Rescue Drone

AEROSAR is an autonomous UAV system designed for emergency search-and-rescue missions using AI-based perception, multi-sensor fusion, autonomous navigation, and resilient communication.

## Project Flow

Military Requirement → Operational Problem → Existing Solutions → Technology Gap → Startup Opportunity

## System Architecture

- Simulation: Webots
- Robotics middleware: ROS 2
- Perception: RGB + thermal vision and AI detection
- Localization: IMU + GNSS
- Navigation: search patterns, obstacle avoidance, mission control
- Backend: API, database, risk scoring, offline queue/synchronization, WebSocket
- Dashboard: live map, detections, alerts, and mission status

## Repository Structure

```text
AEROSAR/
├── worlds/              # Webots simulation worlds
├── drone_description/   # Drone model and sensor configuration
├── aerosar_msgs/        # Custom ROS 2 messages/services
├── perception/          # AI perception and detection
├── navigation/          # Autonomous navigation and search logic
├── backend/             # API, database, sync, and risk scoring
├── frontend/            # Mission dashboard
├── launch/              # Integrated ROS 2 launch files
├── scripts/             # Testing, integration, and demo scripts
└── docs/                # Research and technical documentation
```

## Branch Strategy

```text
feature/*
    ↓
develop
    ↓
integration testing
    ↓
main
```

### Team Feature Branches

- `feature/webots`
- `feature/ai`
- `feature/navigation`
- `feature/backend`
- `feature/dashboard`
- `feature/integration`

## Team

AEROSAR is developed by a 6-member team. Each subsystem is developed independently and integrated through ROS 2 and the shared project architecture.

## Status

🚧 Active development — SIH 2026
