import type { DailyHabitData, HabitEntry } from "./types";

/**
 * Parse the raw content of a dvicente-habit-tracker code block into structured data.
 * Returns null if the content is empty or invalid JSON.
 */
export function parseDailyHabitData(raw: string): DailyHabitData | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (!isValidDailyHabitData(parsed)) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Serialize a DailyHabitData object back to a JSON string for storage in the code block.
 */
export function serializeDailyHabitData(data: DailyHabitData): string {
	return JSON.stringify(data, null, 2);
}

/**
 * Create a default (empty) DailyHabitData for a given date.
 */
export function createEmptyDailyData(date: string): DailyHabitData {
	return { date, entries: [] };
}

/**
 * Find the entry for a specific habit within daily data, or return undefined.
 */
export function findEntry(data: DailyHabitData, habitName: string): HabitEntry | undefined {
	return data.entries.find(e => e.habit === habitName);
}

/**
 * Update or insert an entry for a specific habit within daily data.
 * Returns a new DailyHabitData (immutable update).
 */
export function upsertEntry(data: DailyHabitData, entry: HabitEntry): DailyHabitData {
	const existingIndex = data.entries.findIndex(e => e.habit === entry.habit);
	const newEntries = [...data.entries];

	if (existingIndex >= 0) {
		newEntries[existingIndex] = entry;
	} else {
		newEntries.push(entry);
	}

	return { ...data, entries: newEntries };
}

// -- Validation helpers --

function isValidDailyHabitData(value: unknown): value is DailyHabitData {
	if (typeof value !== "object" || value === null) return false;

	const obj = value as Record<string, unknown>;
	if (typeof obj["date"] !== "string") return false;
	if (!Array.isArray(obj["entries"])) return false;

	return (obj["entries"] as unknown[]).every(isValidHabitEntry);
}

function isValidHabitEntry(value: unknown): value is HabitEntry {
	if (typeof value !== "object" || value === null) return false;

	const obj = value as Record<string, unknown>;
	return (
		typeof obj["habit"] === "string" &&
		typeof obj["value"] === "number" &&
		typeof obj["completed"] === "boolean"
	);
}
