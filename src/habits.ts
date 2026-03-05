import { App, TFile } from "obsidian";
import type { HabitMeta } from "./types";
import { HABIT_TYPE_LINK, EMPTY_UNIT, parseUnit, SPAN_DEFAULT, SPAN_HALF, SPAN_FULL } from "./types";

/** Default section name for habits without an explicit section */
const DEFAULT_SECTION = "Other";

const WIKI_LINK_PATTERN = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/;

/**
 * Scan the vault for all notes with `type: "[[Habit]]"` in their frontmatter.
 * Returns an array of HabitMeta objects with the habit's configuration.
 */
export function discoverHabits(app: App): HabitMeta[] {
	const habits: HabitMeta[] = [];

	const files = app.vault.getMarkdownFiles();
	for (const file of files) {
		const meta = extractHabitMeta(app, file);
		if (meta !== null) {
			habits.push(meta);
		}
	}

	return habits;
}

/**
 * Return the list of habits that are active on a given date.
 * A habit is active if: startDate <= date AND (endDate is null OR date <= endDate).
 */
export function getActiveHabits(habits: HabitMeta[], date: string): HabitMeta[] {
	return habits.filter(h => {
		const afterStart = date >= h.startDate;
		const beforeEnd = h.endDate === null || date <= h.endDate;
		return afterStart && beforeEnd;
	});
}

/**
 * Group habits by their section, preserving insertion order.
 * Sorts habits within each section according to the section note's `order` list.
 * Returns a Map of section name → sorted habits in that section.
 */
export function groupBySection(app: App, habits: HabitMeta[]): Map<string, HabitMeta[]> {
	const groups = new Map<string, HabitMeta[]>();
	for (const habit of habits) {
		const existing = groups.get(habit.section);
		if (existing) {
			existing.push(habit);
		} else {
			groups.set(habit.section, [habit]);
		}
	}

	// Sort each section's habits by the order defined in the section note
	for (const [sectionName, sectionHabits] of groups) {
		const order = readSectionOrder(app, sectionName);
		if (order.length > 0) {
			sortByOrder(sectionHabits, order);
		}
	}

	// Sort sections by `habit_section_sorting` from their note frontmatter
	const sortedEntries = Array.from(groups.entries()).sort(([a], [b]) => {
		const sortA = readSectionSorting(app, a);
		const sortB = readSectionSorting(app, b);
		return sortA - sortB;
	});

	return new Map(sortedEntries);
}

/** Fallback sorting value for sections without `habit_section_sorting` */
const DEFAULT_SECTION_SORTING = Infinity;

/** Frontmatter key used to define section display order */
const SECTION_SORTING_KEY = "habit_section_sorting";

/**
 * Read the `habit_section_sorting` value from a section note's frontmatter.
 * Returns the numeric value, or Infinity if not set (sorts to the end).
 */
function readSectionSorting(app: App, sectionName: string): number {
	const file = resolveSectionFile(app, sectionName);
	if (!file) return DEFAULT_SECTION_SORTING;

	const cache = app.metadataCache.getFileCache(file);
	const value = cache?.frontmatter?.[SECTION_SORTING_KEY];

	return typeof value === "number" ? value : DEFAULT_SECTION_SORTING;
}

/**
 * Read the `order` list from a section note's frontmatter.
 * The section name can be plain text or a wiki-link like "[[Self-improvement]]".
 * Returns an array of habit names, or empty if not found.
 */
export function readSectionOrder(app: App, sectionName: string): string[] {
	const file = resolveSectionFile(app, sectionName);
	if (!file) return [];

	const cache = app.metadataCache.getFileCache(file);
	const order = cache?.frontmatter?.["order"];

	if (!Array.isArray(order)) return [];
	return order.filter((item: unknown): item is string => typeof item === "string");
}

/**
 * Resolve the TFile for a section note.
 * Handles both plain strings ("Home") and wiki-links ("[[Home]]").
 */
export function resolveSectionFile(app: App, sectionName: string): TFile | null {
	const match = sectionName.match(WIKI_LINK_PATTERN);
	const noteName = match ? (match[1] ?? sectionName) : sectionName;

	// Try to find the file by name
	const abstractFile = app.metadataCache.getFirstLinkpathDest(noteName, "");
	return abstractFile instanceof TFile ? abstractFile : null;
}

/**
 * Extract a date string (YYYY-MM-DD) from a daily note's filename.
 * Returns null if the filename doesn't match the expected pattern.
 */
export function extractDateFromFilename(filename: string): string | null {
	const DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.md$/;
	const match = filename.match(DATE_PATTERN);
	return match?.[1] ?? null;
}

// -- Internal helpers --

/**
 * Sort habits in-place according to an ordered list of names.
 * Habits not in the order list are placed at the end, preserving their relative order.
 */
function sortByOrder(habits: HabitMeta[], order: string[]): void {
	const orderIndex = new Map<string, number>();
	for (let i = 0; i < order.length; i++) {
		const name = order[i];
		if (name !== undefined) {
			orderIndex.set(name, i);
		}
	}

	const UNORDERED_OFFSET = order.length;
	habits.sort((a, b) => {
		const indexA = orderIndex.get(a.name) ?? UNORDERED_OFFSET;
		const indexB = orderIndex.get(b.name) ?? UNORDERED_OFFSET;
		return indexA - indexB;
	});
}

function extractHabitMeta(app: App, file: TFile): HabitMeta | null {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache?.frontmatter) return null;

	const fm = cache.frontmatter;

	// Check if this note is of type "[[Habit]]"
	if (!isHabitType(fm["type"])) return null;

	// Support both snake_case (start_date) and camelCase (startDate) frontmatter keys
	const startDate = fm["start_date"] ?? fm["startDate"];
	if (typeof startDate !== "string") return null;

	const rawEndDate = fm["end_date"] ?? fm["endDate"];
	const endDate = typeof rawEndDate === "string" ? rawEndDate : null;
	const target = typeof fm["target"] === "number" ? fm["target"] : 1;
	const unit = typeof fm["unit"] === "string" ? parseUnit(fm["unit"]) : EMPTY_UNIT;
	const section = typeof fm["section"] === "string" ? fm["section"] : DEFAULT_SECTION;
	const span = parseSpan(fm["span"], fm["full_width"]);
	const spanMobile = parseSpanMobile(fm["span_mobile"]);

	// Derive the display name from the filename (strip .md extension)
	const name = file.basename;

	return {
		filePath: file.path,
		name,
		startDate,
		endDate,
		target,
		unit,
		section,
		span,
		spanMobile,
	};
}

/**
 * Parse the `span` frontmatter value into a numeric span.
 * Accepts a number (1, 2, 3…) or the string "full".
 * Falls back to `full_width: true` → SPAN_FULL for backward compatibility.
 * Returns SPAN_DEFAULT (1) if neither is set.
 */
function parseSpan(spanValue: unknown, fullWidthValue: unknown): number {
	if (spanValue === "full") return SPAN_FULL;
	if (spanValue === "half") return SPAN_HALF;
	if (typeof spanValue === "number" && spanValue >= SPAN_DEFAULT) return spanValue;

	// Backward compatibility: full_width: true → full span
	if (fullWidthValue === true) return SPAN_FULL;

	return SPAN_DEFAULT;
}

/**
 * Parse the optional `span_mobile` frontmatter value.
 * Returns null if not set (falls back to desktop span at render time).
 */
function parseSpanMobile(value: unknown): number | null {
	if (value === undefined || value === null) return null;
	if (value === "full") return SPAN_FULL;
	if (value === "half") return SPAN_HALF;
	if (typeof value === "number" && value >= SPAN_DEFAULT) return value;
	return null;
}

/**
 * Check whether a frontmatter `type` value matches the Habit entity type.
 * Handles both wiki-link format ("[[Habit]]") and plain string ("Habit").
 */
function isHabitType(typeValue: unknown): boolean {
	if (typeof typeValue !== "string") return false;
	return typeValue === HABIT_TYPE_LINK || typeValue === "Habit";
}

/**
 * Determine the context in which a code block is embedded.
 * - "habit": the file is a Habit note → show heatmap for this habit
 * - "section": the file is a section note (has `habit_section_sorting` or `order`) → show section heatmaps
 * - "daily": the file is a daily note or anything else → show the full daily tracker
 */
export type BlockContext =
	| { kind: "daily" }
	| { kind: "habit"; habit: HabitMeta }
	| { kind: "section"; sectionName: string; habits: HabitMeta[] };

export function detectBlockContext(app: App, file: TFile | null): BlockContext {
	if (!file) return { kind: "daily" };

	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter;

	// Check if this note is a Habit note
	if (fm && isHabitType(fm["type"])) {
		const habit = extractHabitMeta(app, file);
		if (habit) return { kind: "habit", habit };
	}

	// Check if this note is a section note (has habit_section_sorting or order)
	if (fm && (typeof fm[SECTION_SORTING_KEY] === "number" || Array.isArray(fm["order"]))) {
		const sectionName = `[[${file.basename}]]`;
		const allHabits = discoverHabits(app);
		const sectionHabits = allHabits.filter(h => {
			// Match both "[[Name]]" and plain "Name" section references
			const match = h.section.match(WIKI_LINK_PATTERN);
			const plainSection = match ? (match[1] ?? h.section) : h.section;
			return plainSection === file.basename || h.section === sectionName;
		});

		// Sort by the section's order list
		const order = readSectionOrder(app, sectionName);
		if (order.length > 0) {
			sortByOrder(sectionHabits, order);
		}

		if (sectionHabits.length > 0) {
			return { kind: "section", sectionName, habits: sectionHabits };
		}
	}

	return { kind: "daily" };
}
