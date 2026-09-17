import type { PriorityLevel } from '../types';

/*
 * Rescue priority formula from master doc §11.3–11.6, used ONLY by the
 * simulator / mock server to produce realistic RiskScore messages.
 * The real scores come from Member 4's backend; the dashboard never
 * computes them. Kept here so the demo data matches the doc's numbers.
 */

export const MAX_RELEVANT_DISTANCE = 20; // meters
export const MAX_RELEVANT_COUNT = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface RiskInputs {
  confidence: number; // C
  thermalConfirmed: boolean; // T
  distanceToHazard: number | null; // Dh in meters, null = no known hazard
  clusterCount: number; // N
}

export function priorityFor(score: number): PriorityLevel {
  if (score >= 0.75) return 'CRITICAL';
  if (score >= 0.55) return 'HIGH';
  if (score >= 0.35) return 'MEDIUM';
  return 'LOW';
}

export function buildReason(C: number, hazardProximityRisk: number, N: number, T: boolean, level: PriorityLevel): string {
  const parts: string[] = [];
  if (C >= 0.7) parts.push(`high detection confidence (${C.toFixed(2)})`);
  if (hazardProximityRisk >= 0.5) parts.push('located near an active hazard');
  if (N > 1) parts.push(`${N} survivors detected in cluster`);
  if (T) parts.push('thermal-confirmed');
  if (parts.length === 0) parts.push('baseline detection factors');
  return `${level}: ${parts.join(', ')}`;
}

export function scoreSurvivor(input: RiskInputs) {
  const C = input.confidence;
  const hazardProximityRisk =
    input.distanceToHazard == null ? 0 : clamp(1 - input.distanceToHazard / MAX_RELEVANT_DISTANCE, 0, 1);
  const survivorCountFactor = clamp(input.clusterCount / MAX_RELEVANT_COUNT, 0, 1);
  const thermalBonus = input.thermalConfirmed ? 0.15 : 0;
  const raw = 0.35 * C + 0.3 * hazardProximityRisk + 0.2 * survivorCountFactor + thermalBonus;
  const score = clamp(raw, 0, 1);
  const level = priorityFor(score);
  return {
    score: Math.round(score * 1000) / 1000,
    level,
    reason: buildReason(C, hazardProximityRisk, input.clusterCount, input.thermalConfirmed, level)
  };
}
