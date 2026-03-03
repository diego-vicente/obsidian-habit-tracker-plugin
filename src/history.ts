import { App, TFile } from "obsidian";
import type { DailyHabitData, HabitEntry } from "./types";
import { CODE_BLOCK_LANGUAGE } from "./types";
import { parseDailyHabitData } from "./parser";

/** Regex to match daily note filenames (YYYY-MM-DD.md) */
const DAILY_NOTE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.md$/;

/** Regex to extract the code block content */
const CODE_BLOCK_REGEX = new RegExp(
	"```" + CODE_BLOCK_LANGUAGE + "\\s*\\n([\\s\\S]*?)\\n\\s*```",
);

/**
 * Per-habit, per-day progress: a number 0–100 representing percent completion,
 * or null if the habit had no entry that day (but was active),
 * or undefined if the day has no daily note at all.
 */
export interface HabitHistory {
	/** Map of ISO date string → progress percentage (0–100), or null for "active but no data" */
	days: Map<string, number | null>;
}

/**
 * Scan all daily notes in the given folder and build a history map for each habit.
 * Returns a Map of habit name → HabitHistory.
 */
export async function scanHistory(
	app: App,
	dailyNotesFolder: string,
): Promise<Map<string, DailyHabitData>> {
	const allData = new Map<string, DailyHabitData>();
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		if (!file.path.startsWith(dailyNotesFolder)) continue;

		const dateMatch = file.name.match(DAILY_NOTE_PATTERN);
		if (!dateMatch) continue;

		const date = dateMatch[1];
		if (!date) continue;

		const content = await app.vault.cachedRead(file);
		const blockMatch = content.match(CODE_BLOCK_REGEX);
		if (!blockMatch?.[1]) continue;

		const data = parseDailyHabitData(blockMatch[1]);
		if (data) {
			allData.set(date, data);
		}
	}

	return allData;
}

/**
 * From the full scan data, extract the progress percentage for a specific habit
 * on a specific date. Returns:
 * - A number 0–100 if the habit has an entry
 * - null if a daily note exists but has no entry for this habit
 * - undefined if no daily note exists for this date
 */
export function getHabitProgress(
	allData: Map<string, DailyHabitData>,
	habitName: string,
	habitTarget: number,
	date: string,
): number | null | undefined {
	const dayData = allData.get(date);
	if (!dayData) return undefined;

	const entry = dayData.entries.find(e => e.habit === habitName);
	if (!entry) return null;

	const MAX_PERCENT = 100;
	return Math.min(MAX_PERCENT, Math.round((entry.value / habitTarget) * MAX_PERCENT));
}

/**
 * Get the raw tracked value for a habit on a specific date.
 * Returns:
 * - The numeric value if an entry exists
 * - null if a daily note exists but has no entry for this habit
 * - undefined if no daily note exists for this date
 */
export function getHabitRawValue(
	allData: Map<string, DailyHabitData>,
	habitName: string,
	date: string,
): number | null | undefined {
	const dayData = allData.get(date);
	if (!dayData) return undefined;

	const entry = dayData.entries.find(e => e.habit === habitName);
	if (!entry) return null;

	return entry.value;
}

/** Total number of heatmap color levels */
export const HEATMAP_LEVELS = 8;

/** Levels reserved for values at or below the target */
const LEVELS_AT_TARGET = 5;

/** Levels reserved for values above the target */
const LEVELS_ABOVE_TARGET = HEATMAP_LEVELS - LEVELS_AT_TARGET; // 3

/** Fixed over-target thresholds (multiples of target): 1.5x and 2x */
const OVER_TARGET_THRESHOLD_MID = 1.5;
const OVER_TARGET_THRESHOLD_HIGH = 2.0;

/**
 * Map a raw value to a heatmap level (1–8).
 *
 * Two modes depending on whether the peak exceeds 2x the target:
 *
 * **Fixed mode** (peak <= 2x target):
 *   - Levels 1–5: value / target, split into 5 equal buckets
 *   - Level 6: above target, up to 1.5x target
 *   - Level 7: 1.5x to 2x target
 *   - Level 8: above 2x target (rarely reached in this mode)
 *
 * **Stretched mode** (peak > 2x target):
 *   - All 8 levels distribute evenly across [0, peak]
 *
 * Returns 0 if value is 0.
 */
export function valueToLevel(value: number, peakValue: number, target: number): number {
	if (value <= 0 || peakValue <= 0) return 0;

	const stretchThreshold = target * OVER_TARGET_THRESHOLD_HIGH;

	if (peakValue > stretchThreshold) {
		// Stretched mode: all 8 levels across [0, peak]
		const normalized = Math.min(value, peakValue) / peakValue;
		return Math.min(HEATMAP_LEVELS, Math.max(1, Math.ceil(normalized * HEATMAP_LEVELS)));
	}

	// Fixed mode: levels 1-5 for [0, target], levels 6-8 for above target
	if (value <= target) {
		const normalized = value / target;
		return Math.min(LEVELS_AT_TARGET, Math.max(1, Math.ceil(normalized * LEVELS_AT_TARGET)));
	}

	// Above target — fixed thresholds
	const midBoundary = target * OVER_TARGET_THRESHOLD_MID;
	if (value <= midBoundary) return LEVELS_AT_TARGET + 1; // level 6
	if (value <= stretchThreshold) return LEVELS_AT_TARGET + 2; // level 7
	return HEATMAP_LEVELS; // level 8
}

/**
 * Generate an array of ISO date strings for the last N days ending at `endDate`,
 * aligned to start on a Monday so the grid rows map to weekdays.
 */
export function generateDateRange(endDate: string, maxColumns: number): string[] {
	const DAYS_PER_WEEK = 7;
	const end = new Date(endDate + "T00:00:00");

	// Align end to the last day of its week (Sunday)
	const endDayOfWeek = end.getDay(); // 0=Sun, 1=Mon, ...
	const SUNDAY = 0;
	const daysUntilSunday = endDayOfWeek === SUNDAY ? 0 : (DAYS_PER_WEEK - endDayOfWeek);
	end.setDate(end.getDate() + daysUntilSunday);

	const totalDays = maxColumns * DAYS_PER_WEEK;
	const start = new Date(end);
	start.setDate(end.getDate() - totalDays + 1);

	const dates: string[] = [];
	const cursor = new Date(start);
	while (cursor <= end) {
		dates.push(toISODate(cursor));
		cursor.setDate(cursor.getDate() + 1);
	}

	return dates;
}

export function toISODate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
