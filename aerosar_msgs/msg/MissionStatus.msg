# aerosar_msgs/msg/MissionStatus.msg
# Drone mission status and connectivity report

string mission_id           # Unique mission identifier
string state                  # "IDLE" | "SEARCHING" | "RETURNING" | "COMPLETE"
float32 battery_percent        # Simulated remaining battery percentage (0-100)
float32 coverage_percent       # Simulated search area coverage percentage (0-100)
bool link_connected            # Connectivity status (true = online, false = offline)
builtin_interfaces/Time stamp  # Status report timestamp
