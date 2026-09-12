# aerosar_msgs/msg/RiskScore.msg
# Risk score and priority level assigned by backend evaluation engine

string detection_id         # References Detection.id
float32 score                # Numeric score (0.0 to 1.0)
string priority_level        # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
string reason                # Explainable plain-text reasoning string
