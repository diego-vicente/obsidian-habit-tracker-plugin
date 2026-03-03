/**
 * Metadata for a habit, extracted from a Habit note's frontmatter.
 *
 * Habit notes have:
 *   type: "[[Habit]]"
 *   startDate: YYYY-MM-DD
 *   endDate: YYYY-MM-DD (optional)
 *   target: number
 *   unit: string
 */
export interface HabitMeta {
	/** The Obsidian file path of the habit note */
	filePath: string;
	/** Display name (derived from the note's filename) */
	name: string;
	/** Date from which the habit is active (inclusive) */
	startDate: string;
	/** Date at which the habit ends (inclusive), or null if ongoing */
	endDate: string | null;
	/** Daily target value (e.g. 10 for "10 pages") */
	target: number;
	/** Unit of measurement in singular/plural form (e.g. { singular: "page", plural: "pages" }) */
	unit: UnitLabel;
	/** Optional grouping section (e.g. "Self-improvement", "Home") */
	section: string;
	/**
	 * Number of grid columns this card should span in compact view (desktop).
	 * 1 = single cell (default), 1.5 = half row, 2 = two-thirds, "full" = entire row.
	 * Stored as a number; the special value SPAN_FULL (-1) means span all columns.
	 */
	span: number;
	/**
	 * Column span override for mobile. If null, falls back to `span`.
	 */
	spanMobile: number | null;
}

/**
 * A single habit's tracked data for one day.
 */
export interface HabitEntry {
	/** The habit name (must match a HabitMeta.name) */
	habit: string;
	/** The recorded value for the day (e.g. 15 pages read) */
	value: number;
	/** Whether the habit was completed (value >= target) */
	completed: boolean;
}

/**
 * The full JSON structure stored in a ```dvicente-habit-tracker code block.
 */
export interface DailyHabitData {
	/** ISO date string (YYYY-MM-DD) matching the daily note */
	date: string;
	/** Tracked entries for each habit */
	entries: HabitEntry[];
}

/**
 * Unit label with singular and plural forms.
 * Parsed from frontmatter format "singular/plural" (e.g. "page/pages").
 * If only one form is provided, it is used for both.
 */
export interface UnitLabel {
	singular: string;
	plural: string;
}

/** Separator used in the frontmatter "unit" field (e.g. "page/pages") */
const UNIT_SEPARATOR = "/";

/**
 * Parse a unit string from frontmatter into singular/plural forms.
 * Accepts "singular/plural" (e.g. "page/pages") or a plain string used for both.
 */
export function parseUnit(raw: string): UnitLabel {
	const parts = raw.split(UNIT_SEPARATOR);
	const singular = (parts[0] ?? "").trim();
	const plural = (parts[1] ?? singular).trim();
	return { singular, plural };
}

/**
 * Return the appropriate unit form for a given numeric value.
 */
export function formatUnit(unit: UnitLabel, value: number): string {
	return value === 1 ? unit.singular : unit.plural;
}

/** An empty unit label, used when no unit is specified */
export const EMPTY_UNIT: UnitLabel = { singular: "", plural: "" };

/** Default span: card occupies ~1/3 of the row */
export const SPAN_DEFAULT = 1;

/** Half-row span */
export const SPAN_HALF = 1.5;

/** Special span value meaning "span the entire row" */
export const SPAN_FULL = -1;

/**
 * Number of underlying CSS grid columns.
 * Using 6 allows clean representation of thirds (2), halves (3),
 * two-thirds (4), and full (6).
 */
export const GRID_COLUMNS = 6;

/**
 * Convert a logical span value to the number of CSS grid columns.
 */
export function spanToGridColumns(span: number): number {
	if (span === SPAN_FULL) return GRID_COLUMNS;
	if (span === SPAN_HALF) return GRID_COLUMNS / 2; // 3
	// span 1 → 2 columns, span 2 → 4 columns
	return Math.min(GRID_COLUMNS, span * 2);
}

/** Identifier for the code block language registered with Obsidian */
export const CODE_BLOCK_LANGUAGE = "dvicente-habit-tracker";

/** The frontmatter type value that identifies Habit notes (wiki-link format) */
export const HABIT_TYPE_LINK = "[[Habit]]";
