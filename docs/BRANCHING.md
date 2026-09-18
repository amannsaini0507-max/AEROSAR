# Branching and Integration Policy

## Flow

`feature/*` → `develop` → integration testing → `main`

## Feature Branches

- `feature/webots`
- `feature/ai`
- `feature/navigation`
- `feature/backend`
- `feature/dashboard`
- `feature/integration`

## Integration Owner

Member 6 owns integration testing, merge coordination, launch integration, and demo readiness.

## Rule

Do not push unfinished subsystem work directly to `main`. Feature work should be integrated through `develop` and tested before promotion to `main`.
