# AEROSAR — 5-Minute Live Presentation Script & Demo Cheat Sheet

> **Target Duration:** 5 to 6 minutes  
> **Presenter Roles:** Member 6 (Lead & Stage Manager), Member 1 (Sim), Member 2 (AI), Member 3 (Nav), Member 4 (Backend), Member 5 (Dashboard)

---

## ⏱️ Minute-by-Minute Timeline & Narration

### **0:00 – 0:45 | Setup & Problem Framing (Member 6 / Lead)**
* **Visual:** Dashboard homepage or title slide displayed.
* **Narration:**  
  > *"Good morning judges. This is AEROSAR — an AI-powered autonomous drone system for emergency search and rescue, built for Problem Statement 26177.  
  > In a disaster, the first 60 minutes are critical. Disaster response teams need immediate situational awareness before sending human rescuers into dangerous collapse or fire zones. AEROSAR delivers that awareness autonomously—with on-device AI, multi-sensor fusion, explainable risk scoring, and zero dependence on cloud connectivity."*

---

### **0:45 – 1:30 | Autonomous Search & GPS-Denied Navigation (Member 1 & Member 3)**
* **Visual:** Drone launching in Webots simulation world and flying search grid; dashboard map updates path.
* **Narration (Member 1 & 3):**  
  > *"The drone has launched and is flying a serpentine search pattern over the affected disaster zone. It streams velocity commands to `/navigation/cmd_vel` at 20 Hz.  
  > When the drone flies under structure cover where GPS is blocked, it automatically transitions from `GPS_NAV` mode to `GPS_DENIED` local SLAM mode—maintaining stability and heading without stopping or crashing."*

---

### **1:30 – 2:45 | On-Device AI, Thermal Fusion & CRITICAL Risk Scoring (Member 2 & Member 4)**
* **Visual:** Drone approaches burning structure. Survivor detected. RGB/Thermal view toggles. Priority list updates to CRITICAL (Red).
* **Narration (Member 2 & 4):**  
  > *"Here, the drone's on-device YOLO detector identifies a person candidate. To eliminate false positives, our fusion node checks the thermal camera channel—confirming a live heat signature.  
  > Next, our backend risk engine evaluates the detection against nearby fire hazards. Because the survivor is 4 meters from active flame, the system assigns a CRITICAL priority score of 0.85—and generates an explainable reason string: 'CRITICAL: high confidence, thermal-confirmed, 4m from active fire'."*

---

### **2:45 – 3:45 | Requirement 7 Offline Resilience Demo Beat (Member 6)**
* **Visual:** Member 6 runs `python3 scripts/network_toggle.py cut`. Dashboard top bar switches to `OFFLINE`.
* **Narration (Member 6):**  
  > *"Disaster zones rarely have stable Wi-Fi or cellular networks. Watch what happens when we cut the connection right now. [Cut link]  
  > The dashboard switches to OFFLINE, but the drone does NOT stop. It logs every survivor and hazard locally to an SQLite database queue.  
  > Now we restore the network. [Restore link] The sync engine drains the queue, restoring all events to the command center in exact timestamp order with ZERO data loss."*

---

### **3:45 – 5:00 | Command Center Map, Safe Routing & Conclusion (Member 5 & Member 6)**
* **Visual:** Leaflet map displays pins, hazard zones, and safe A* access route.
* **Narration (Member 5 & 6):**  
  > *"On the dashboard, rescue commanders see real-time survivor pins, hazard boundaries, and an A* safe access route calculated around fire zones. Every mission is archived in the browser for post-operation replay.  
  > AEROSAR delivers autonomous search, multi-sensor fusion, explainable risk scoring, and offline resilience—built for real disaster conditions. Thank you!"*

---

## ❓ Judge Q&A Defense Cheat Sheet (Anticipated Questions)

| Question | Recommended Honest Answer |
|---|---|
| **"Is hazard detection real ML or simulated?"** | *"Person detection is a real COCO-pretrained YOLO model. Hazard classes are represented via tagged simulation objects in Webots for the prototype—the architecture is modular, so swap-in trained hazard models without touching the fusion or dashboard code."* |
| **"How does the drone navigate without GPS?"** | *"In prototype simulation, GPS loss triggers IMU dead-reckoning and local frame tracking (Mode B). In production on hardware, this maps to visual-inertial odometry / RTAB-Map SLAM."* |
| **"What if thermal confirmation fails?"** | *"RGB detections are never silently dropped if thermal misses. Unconfirmed detections are still logged and mapped, but given a lower confidence weight in the risk formula."* |
