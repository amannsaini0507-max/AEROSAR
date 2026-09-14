#!/usr/bin/env python3
"""
AEROSAR Member 3 Navigation Test Runner Wrapper
Member 3 — Autonomous Navigation / SLAM Lead
SIH 2026 — PS 26177
"""

import os
import sys
import subprocess

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_SCRIPT = os.path.join(PROJECT_ROOT, "navigation", "test_navigation.py")


def main():
    res = subprocess.run([sys.executable, TEST_SCRIPT], check=True)
    sys.exit(res.returncode)


if __name__ == "__main__":
    main()
