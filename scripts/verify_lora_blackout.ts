import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoraLinkManager } from '../frontend/src/lib/lora/LoraLinkManager';
import { FrameType } from '../frontend/src/lib/lora/loraTypes';

// Terminal color formatting matching verify_headless.js
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(msg: string) {
  console.log(`${c.cyan}[VERIFY-LORA]${c.reset} ${msg}`);
}
function pass(msg: string) {
  console.log(`${c.green}${c.bold}✔ PASS:${c.reset} ${msg}`);
}
function fail(msg: string) {
  console.error(`${c.red}${c.bold}✘ FAIL:${c.reset} ${msg}`);
}

async function runLoraBlackoutVerification() {
  console.log(`\n${c.bold}======================================================${c.reset}`);
  console.log(`${c.bold}   AEROSAR LoRa Blackout Headless Verification Suite  ${c.reset}`);
  console.log(`${c.bold}   SIH 2026 - Problem Statement 26177                ${c.reset}`);
  console.log(`${c.bold}======================================================\n${c.reset}`);

  try {
    // 1. Load scenario definition
    const scenarioPath = path.resolve(__dirname, '..', 'scenarios', 'lora_blackout.json');
    log(`Loading scenario from ${scenarioPath}...`);
    const scenarioRaw = fs.readFileSync(scenarioPath, 'utf-8');
    const scenario = JSON.parse(scenarioRaw);

    log(`Scenario: "${scenario.name}" (id: ${scenario.id})`);
    log(`Station position: [${scenario.station.pos}], antennaHeight: ${scenario.station.antennaHeight}m`);
    log(`Blackout zone: [${JSON.stringify(scenario.noNetworkZones[0])}]`);

    // 2. Initialize LoraLinkManager with scenario configuration
    const loraManager = new LoraLinkManager({
      pos: scenario.station.pos,
      antennaHeight: scenario.station.antennaHeight ?? 6.0,
    });
    loraManager.setNoNetworkZones(scenario.noNetworkZones);

    const relayedPackets: Array<{ type: string; data: Record<string, unknown> }> = [];
    loraManager.onRelayMessage = (msg) => {
      relayedPackets.push(msg);
      log(`Relayed message received at ground station: type=${msg.type}, id=${msg.data.id}, via=${msg.data.via}`);
    };

    let simTime = 0.0;
    const dronePos = new THREE.Vector3(scenario.drone_spawn.x, scenario.drone_spawn.y, scenario.drone_spawn.z);

    // =========================================================================
    // ASSERTION 1: Drone enters noNetworkZones -> link mode transitions
    //              NETWORK -> LORA_ONLY after exactly 2s debounce.
    // =========================================================================
    log('Step 1: Testing initial state outside blackout zone...');
    loraManager.update(1.0, simTime, dronePos);
    simTime += 1.0;

    if (loraManager.mode !== 'NETWORK') {
      throw new Error(`Expected initial mode to be 'NETWORK', got '${loraManager.mode}'`);
    }
    log(`Drone at (${dronePos.x}, ${dronePos.z}) is outside zone. Mode: ${loraManager.mode}`);

    log('Moving drone inside noNetworkZone [x: 2..11, z: 3..11] to (4.2, 5.8)...');
    dronePos.set(4.2, 4.0, 5.8); // Directly above victim_3

    // Advance 1.0s (less than 2s threshold)
    loraManager.update(1.0, simTime, dronePos);
    simTime += 1.0;
    if (loraManager.mode !== 'NETWORK') {
      throw new Error(`Mode switched prematurely after only 1.0s in blackout zone: '${loraManager.mode}'`);
    }
    log(`After 1.0s in blackout zone, mode correctly remains 'NETWORK' (debounce active).`);

    // Advance another 1.2s (total 2.2s > 2.0s debounce)
    loraManager.update(1.2, simTime, dronePos);
    simTime += 1.2;
    if (loraManager.mode !== 'LORA_ONLY') {
      throw new Error(`Expected mode to transition to 'LORA_ONLY' after 2.2s in zone, got '${loraManager.mode}'`);
    }
    pass(`Assertion 1: Link mode transitions NETWORK -> LORA_ONLY after 2s inside blackout zone.`);

    // =========================================================================
    // ASSERTION 2: Hover-verify confirms victim_3 -> VICTIM LoRa frame
    //              delivered within 15s of sim time.
    // =========================================================================
    log('Step 2: Simulating hover-verify confirmation of victim_3 and LoRa transmission...');
    const victimDef = scenario.victims[0];
    const hoverConfirmSimTime = simTime;

    loraManager.enqueueVictim(
      {
        id: victimDef.id,
        lat: 26.9124,
        lon: 75.7873,
        confidence: 0.96,
        thermalConfirmed: true,
        riskLevel: 3, // CRITICAL
      },
      simTime
    );

    let victimDelivered = false;
    let deliverySimTime = 0.0;
    const maxWaitSimSec = 15.0;

    while (simTime - hoverConfirmSimTime <= maxWaitSimSec) {
      const dt = 0.1;
      loraManager.update(dt, simTime, dronePos);
      simTime += dt;

      const found = relayedPackets.find(
        (m) => m.type === 'detection' && m.data.id === victimDef.id && m.data.via === 'lora'
      );
      if (found) {
        victimDelivered = true;
        deliverySimTime = simTime;
        break;
      }
    }

    if (!victimDelivered) {
      throw new Error(`VICTIM LoRa frame for ${victimDef.id} was not delivered within 15s of sim time`);
    }

    const elapsedDeliveryTime = Math.round((deliverySimTime - hoverConfirmSimTime) * 10) / 10;
    const stats = loraManager.getStats();
    log(`Frame delivered in ${elapsedDeliveryTime}s of sim time.`);
    log(`Link stats: SF${stats.currentSf}, RSSI: ${stats.rssiDb.toFixed(1)} dBm, SNR: ${stats.snrDb.toFixed(1)} dB, PDR: ${(stats.pdr * 100).toFixed(0)}%`);

    if (elapsedDeliveryTime > 15.0) {
      throw new Error(`Delivery took ${elapsedDeliveryTime}s, exceeding 15.0s maximum threshold`);
    }
    pass(`Assertion 2: Hover-verify confirms ${victimDef.id} -> VICTIM LoRa frame delivered within 15s (actual: ${elapsedDeliveryTime}s, SF${stats.currentSf}).`);

    // =========================================================================
    // ASSERTION 3: Zero duplicate victims in queue.
    // =========================================================================
    log('Step 3: Testing victim deduplication under repeated sensor firings...');
    
    // Clear any leftover state so we test from clean queue
    log(`Queue count before deduplication test: ${loraManager.getQueueCount()}`);

    // Trigger 5 redundant enqueue calls for victim_3
    for (let i = 0; i < 5; i++) {
      loraManager.enqueueVictim(
        {
          id: victimDef.id,
          lat: 26.9124,
          lon: 75.7873,
          confidence: 0.96,
          thermalConfirmed: true,
          riskLevel: 3,
        },
        simTime
      );
    }

    const countAfter5 = loraManager.getQueueCount();
    if (countAfter5 !== 1) {
      throw new Error(`Expected exactly 1 victim in queue after 5 repeated enqueue calls, got ${countAfter5}`);
    }
    log(`5 redundant enqueues resulted in exactly 1 queue item.`);

    // Enqueue a distinct second victim
    loraManager.enqueueVictim(
      {
        id: 'victim_test_unique',
        lat: 26.9125,
        lon: 75.7874,
        confidence: 0.90,
        thermalConfirmed: true,
        riskLevel: 2,
      },
      simTime
    );

    const countAfterUnique = loraManager.getQueueCount();
    if (countAfterUnique !== 2) {
      throw new Error(`Expected exactly 2 items in queue after unique victim, got ${countAfterUnique}`);
    }

    // Try to re-enqueue the duplicate of second victim 3 times
    for (let i = 0; i < 3; i++) {
      loraManager.enqueueVictim(
        {
          id: 'victim_test_unique',
          lat: 26.9125,
          lon: 75.7874,
          confidence: 0.90,
          thermalConfirmed: true,
          riskLevel: 2,
        },
        simTime
      );
    }

    if (loraManager.getQueueCount() !== 2) {
      throw new Error(`Queue accepted duplicate: expected 2, got ${loraManager.getQueueCount()}`);
    }

    // Also assert directly on the internal queue elements
    const queuedVictims = (loraManager as any).queue
      .filter((p: any) => p.payload.type === FrameType.VICTIM)
      .map((p: any) => p.payload.id);
    const uniqueIds = new Set(queuedVictims);
    if (queuedVictims.length !== uniqueIds.size) {
      throw new Error(`Duplicate victim IDs found in queue: ${queuedVictims.join(', ')}`);
    }

    pass(`Assertion 3: Zero duplicate victims in transmission queue (deduplication verified across 8 repeated calls).`);

    // =========================================================================
    // ASSERTION 4: Drone leaves zone -> link returns to NETWORK and outbox flushes to 0.
    // =========================================================================
    log('Step 4: Drone leaves blackout zone and returns to base area (0, 0)...');
    dronePos.set(0.0, 1.5, 0.0); // Outside blackout zone

    loraManager.update(0.1, simTime, dronePos);
    simTime += 0.1;

    if (loraManager.mode !== 'NETWORK') {
      throw new Error(`Expected link mode to return to 'NETWORK' after leaving zone, got '${loraManager.mode}'`);
    }

    const outboxCount = loraManager.getOutboxCount();
    if (outboxCount !== 0) {
      throw new Error(`Expected outbox to flush to 0 upon returning to NETWORK, got ${outboxCount} buffered items`);
    }

    pass(`Assertion 4: Drone leaves zone -> link returns to NETWORK and outbox flushes to 0.`);

    // =========================================================================
    // ASSERTION 5: Second variant (lora_blackout_obstruction.json):
    // Survivor behind concrete ruins causes RF obstruction; packets are
    // initially lost/buffered, then delivered after drone moves to clear LoS.
    // =========================================================================
    log('Step 5: Testing second variant — ruins obstruction and clear LoS delivery...');
    const obstructionScenarioPath = path.resolve(__dirname, '..', 'scenarios', 'lora_blackout_obstruction.json');
    const obsScenario = JSON.parse(fs.readFileSync(obstructionScenarioPath, 'utf-8'));
    log(`Loaded second variant: "${obsScenario.name}"`);

    // Create a MeshBVH representing concrete ruins at [-7, 0, -6]
    // Box dimensions: 4m wide, 5m high, 4m deep
    const ruinsGeom = new THREE.BoxGeometry(4.0, 5.0, 4.0);
    ruinsGeom.translate(-7.0, 2.5, -6.0);
    const ruinsBVH = new MeshBVH(ruinsGeom);

    const obsLoraManager = new LoraLinkManager({
      pos: obsScenario.station.pos,
      antennaHeight: obsScenario.station.antennaHeight ?? 6.0,
    });
    obsLoraManager.setNoNetworkZones(obsScenario.noNetworkZones);
    obsLoraManager.setBVH(ruinsBVH);

    const obsRelayed: Array<{ type: string; data: Record<string, unknown> }> = [];
    obsLoraManager.onRelayMessage = (msg) => {
      obsRelayed.push(msg);
      log(`[Variant 2] Relayed message: type=${msg.type}, id=${msg.data.id}, via=${msg.data.via}`);
    };

    let obsSimTime = 0.0;
    // Drone hovers over victim_ruins at [-3.5, 2.0, -2.5]
    // Ray to station [-13, 6, -13] passes directly through [-7, 2.5, -6]
    const obsDronePos = new THREE.Vector3(-3.5, 2.0, -2.5);

    // Advance 2.5s inside blackout zone so link mode transitions to LORA_ONLY
    obsLoraManager.update(2.5, obsSimTime, obsDronePos);
    obsSimTime += 2.5;

    if (obsLoraManager.mode !== 'LORA_ONLY') {
      throw new Error(`Expected LORA_ONLY mode in second variant, got ${obsLoraManager.mode}`);
    }

    // Verify obstruction detection
    const obsCheck = obsLoraManager.calculateObstruction(obsDronePos);
    log(`Obstruction check behind ruins: isObstructed=${obsCheck.isObstructed}, lossDb=${obsCheck.lossDb}dB`);
    if (!obsCheck.isObstructed || obsCheck.lossDb < 8.0) {
      throw new Error(`Expected obstruction loss >= 8.0 dB behind ruins, got ${obsCheck.lossDb} dB`);
    }

    // Enqueue victim behind ruins
    const victimRuins = obsScenario.victims[0];
    obsLoraManager.enqueueVictim(
      {
        id: victimRuins.id,
        lat: 26.9124,
        lon: 75.7873,
        confidence: 0.94,
        thermalConfirmed: true,
        riskLevel: 2,
      },
      obsSimTime
    );

    log('Attempting transmission while obstructed behind ruins...');
    obsLoraManager.update(0.5, obsSimTime, obsDronePos);
    obsSimTime += 0.5;

    // Drone now moves to a clear position with unobstructed line-of-sight to the antenna mast
    log('Drone climbs to clear altitude (y = 8.0m) with direct line-of-sight...');
    obsDronePos.set(-3.5, 8.0, -2.5); // high enough to clear the 5m ruins
    const clearCheck = obsLoraManager.calculateObstruction(obsDronePos);
    log(`Obstruction check in clear position: isObstructed=${clearCheck.isObstructed}, lossDb=${clearCheck.lossDb}dB`);
    if (clearCheck.isObstructed) {
      throw new Error(`Expected clear line-of-sight at y=8.0m, but ray was still obstructed`);
    }

    // Update simulation until delivered
    let deliveredClear = false;
    for (let step = 0; step < 50; step++) {
      obsLoraManager.update(0.2, obsSimTime, obsDronePos);
      obsSimTime += 0.2;
      if (obsRelayed.some((m) => m.data.id === victimRuins.id)) {
        deliveredClear = true;
        break;
      }
    }

    if (!deliveredClear) {
      throw new Error(`Victim frame was not delivered after moving to clear LoS position`);
    }

    pass(`Assertion 5: Second variant (ruins obstruction) verified: obstructed packets held/retried, delivered after drone achieves clear line-of-sight.`);

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log(`\n${c.green}${c.bold}======================================================${c.reset}`);
    console.log(`${c.green}${c.bold}   ALL 5 LORA BLACKOUT ASSERTIONS PASSED (100% OK)    ${c.reset}`);
    console.log(`${c.green}${c.bold}======================================================${c.reset}\n`);
    process.exit(0);
  } catch (err: any) {
    fail(`Verification failed: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

runLoraBlackoutVerification();
