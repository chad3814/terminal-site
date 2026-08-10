import { isJsonObject, parseJson } from "@/shared/json";

export const MIN_SPLIT_PERCENT = 10;
export const MAX_SPLIT_PERCENT = 90;
export const DIVIDER_SIZE_PX = 6;
export const SPLIT_STORAGE_KEY = "terminal-site.split";

export interface SplitState {
  col: number;
  row: number;
}

export const DEFAULT_SPLIT: SplitState = { col: 50, row: 50 };

export function clampSplit(percent: number): number {
  if (Number.isNaN(percent)) return DEFAULT_SPLIT.col;
  if (percent < MIN_SPLIT_PERCENT) return MIN_SPLIT_PERCENT;
  if (percent > MAX_SPLIT_PERCENT) return MAX_SPLIT_PERCENT;
  return percent;
}

export function splitFromPointer(
  pointer: number,
  containerStart: number,
  containerSize: number,
): number {
  if (containerSize <= 0) return DEFAULT_SPLIT.col;
  return clampSplit(((pointer - containerStart) / containerSize) * 100);
}

export function nudgeSplit(percent: number, delta: number): number {
  return clampSplit(percent + delta);
}

export function gridTemplate(percent: number): string {
  return `${percent}% ${DIVIDER_SIZE_PX}px 1fr`;
}

export function serializeSplit(split: SplitState): string {
  return JSON.stringify(split);
}

export function parseStoredSplit(raw: string | null): SplitState {
  if (raw === null) return DEFAULT_SPLIT;

  const parsed = parseJson(raw);
  if (parsed === null || !isJsonObject(parsed)) return DEFAULT_SPLIT;
  if (typeof parsed.col !== "number" || typeof parsed.row !== "number") {
    return DEFAULT_SPLIT;
  }

  return { col: clampSplit(parsed.col), row: clampSplit(parsed.row) };
}
