import { SECONDS_PER_DAY, TICKS_PER_SECOND } from '../engine/constants';

export const TICKS_PER_DAY = SECONDS_PER_DAY * TICKS_PER_SECOND;

export function dayOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) + 1;
}

export function dayLabel(tick: number): string {
  return `Day ${dayOf(tick)}`;
}

export function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
