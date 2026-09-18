# aerosar_msgs/msg/Alert.msg
# Emergency alert generated for command center and rescue team dispatch

string alert_id             # Unique alert ID
string alert_type            # "SURVIVOR_DETECTED" | "HAZARD_DETECTED" | "CRITICAL_PRIORITY" | "LINK_LOST" | "LINK_RESTORED"
string message              # Human-readable alert message
float64 latitude            # Event latitude
float64 longitude           # Event longitude
builtin_interfaces/Time stamp # Alert timestamp
