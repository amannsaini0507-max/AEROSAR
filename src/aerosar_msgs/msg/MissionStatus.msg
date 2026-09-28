# aerosar_msgs/msg/MissionStatus.msg
# Mission telemetry and connectivity status broadcast by Member 1 (Drone Sim) / Member 6

string mission_id
string state
float32 battery_percent
float32 coverage_percent
bool link_connected
builtin_interfaces/Time stamp
