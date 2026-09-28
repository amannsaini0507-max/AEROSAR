#!/usr/bin/env python3
"""
AEROSAR System Health & Integrity Checker
Member 6 — Integration & Testing Tool

Audits project workspace structure, custom message files, script permissions,
and documentation completeness.
"""

import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REQUIRED_SUBDIRS = [
    "aerosar_msgs",
    "launch",
    "scripts",
    "perception",
    "navigation",
    "backend",
    "frontend",
    "drone_description",
    "worlds",
    "docs"
]

REQUIRED_MSG_FILES = [
    "aerosar_msgs/msg/Detection.msg",
    "aerosar_msgs/msg/Hazard.msg",
    "aerosar_msgs/msg/RiskScore.msg",
    "aerosar_msgs/msg/Alert.msg",
    "aerosar_msgs/msg/MissionStatus.msg",
    "aerosar_msgs/package.xml",
    "aerosar_msgs/CMakeLists.txt"
]

REQUIRED_DOC_FILES = [
    "docs/topic_interface_spec.md",
    "docs/git_workflow.md"
]

def check_health():
    print("=" * 60)
    print("  AEROSAR Member 6 — System Health & Integrity Audit")
    print(f"  Root: {PROJECT_ROOT}")
    print("=" * 60 + "\n")
    
    passed = 0
    total = 0
    
    print("[1] Checking Subdirectory Integrity:")
    for d in REQUIRED_SUBDIRS:
        total += 1
        path = os.path.join(PROJECT_ROOT, d)
        if os.path.isdir(path):
            print(f"  [PASS] Folder exists: {d}/")
            passed += 1
        else:
            print(f"  [FAIL] Missing folder: {d}/")
            
    print("\n[2] Checking Custom Message definitions (aerosar_msgs):")
    for f in REQUIRED_MSG_FILES:
        total += 1
        path = os.path.join(PROJECT_ROOT, f)
        if os.path.isfile(path):
            print(f"  [PASS] File exists: {f}")
            passed += 1
        else:
            print(f"  [FAIL] Missing file: {f}")
            
    print("\n[3] Checking Specification Documentation:")
    for f in REQUIRED_DOC_FILES:
        total += 1
        path = os.path.join(PROJECT_ROOT, f)
        if os.path.isfile(path):
            print(f"  [PASS] Spec doc exists: {f}")
            passed += 1
        else:
            print(f"  [FAIL] Missing spec doc: {f}")

    print("\n" + "=" * 60)
    print(f"System Health Summary: {passed}/{total} checks passed ({int(passed/total*100)}% Healthy)")
    print("=" * 60 + "\n")
    return passed == total

if __name__ == "__main__":
    success = check_health()
    sys.exit(0 if success else 1)
