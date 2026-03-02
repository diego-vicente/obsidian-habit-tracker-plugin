import { App, MarkdownView, TFile, setIcon } from "obsidian";
import type { HabitMeta, HabitEntry, DailyHabitData } from "./types";
import { formatUnit } from "./types";
import type { HabitTrackerSettings } from "./settings";
import { findEntry, upsertEntry } from "./parser";
import { discoverHabits, getActiveHabits, groupBySection } from "./habits";
import { SectionEditorModal } from "./section-editor";
import { writeDataToFile } from "./file-utils";
import { HabitDetailModal } from "./modal";
import { scanHistory, getHabitProgress, generateDateRange, toISODate } from "./history";

const MIN_VALUE = 0;
const STEP = 1;
const MAX_PROGRESS_PERCENT = 100;

type ViewMode = "compact" | "detailed";

/**
 * Render the habit tracker UI inside a code block container.
 */
export function renderHabitTracker(
	data: DailyHabitData,
	el: HTMLElement,
	app: App,
	file: TFile | null,
	settings: HabitTrackerSettings,
): void {
	const allHabits = discoverHabits(app);
	const activeHabits = getActiveHabits(allHabits, data.date);

	el.empty();
	el.addClass("habit-tracker");

	if (activeHabits.length === 0) {
		const emptyMsg = el.createDiv({ cls: "habit-tracker-empty" });
		emptyMsg.createEl("p", {
			text: "No active habits found for this date. Create a note with type: \"[[Habit]]\" to get started.",
		});
		return;
	}

	// -- View toggle --
	let currentMode: ViewMode = "compact";
	const toolbar = el.createDiv({ cls: "habit-tracker-toolbar" });
	const contentArea = el.createDiv({ cls: "habit-tracker-content" });

	const compactBtn = toolbar.createEl("button", {
		cls: "habit-tracker-view-btn active",
		attr: { "aria-label": "Compact view" },
	});
	setIcon(compactBtn.createSpan(), "grid-2x2");

	const detailedBtn = toolbar.createEl("button", {
		cls: "habit-tracker-view-btn",
		attr: { "aria-label": "Detailed view" },
	});
	setIcon(detailedBtn.createSpan(), "calendar-range");

	const renderContent = () => {
		contentArea.empty();
		if (currentMode === "compact") {
			renderCompactView(contentArea, activeHabits, data, app, file);
		} else {
			renderHeatmapView(contentArea, activeHabits, data, app, settings);
		}
		renderSummary(contentArea, activeHabits, data);
	};

	compactBtn.addEventListener("click", () => {
		if (currentMode === "compact") return;
		currentMode = "compact";
		compactBtn.addClass("active");
		detailedBtn.removeClass("active");
		renderContent();
	});

	detailedBtn.addEventListener("click", () => {
		if (currentMode === "detailed") return;
		currentMode = "detailed";
		detailedBtn.addClass("active");
		compactBtn.removeClass("active");
		renderContent();
	});

	renderContent();
}

// ============================================================
// Compact view (chips)
// ============================================================

function renderCompactView(
	container: HTMLElement,
	activeHabits: HabitMeta[],
	data: DailyHabitData,
	app: App,
	file: TFile | null,
): void {
	const sections = groupBySection(app, activeHabits);
	const showSectionHeaders = sections.size > 1;

	for (const [sectionName, habits] of sections) {
		const sectionEl = container.createDiv({ cls: "habit-tracker-section" });

		if (showSectionHeaders) {
			renderSectionHeader(sectionEl, sectionName, habits, data, app, file);
		}

		const grid = sectionEl.createDiv({ cls: "habit-tracker-grid" });
		for (const habit of habits) {
			const entry = findEntry(data, habit.name);
			renderCard(grid, habit, entry ?? null, data, app, file);
		}
	}
}

function renderCard(
	container: HTMLElement,
	habit: HabitMeta,
	entry: HabitEntry | null,
	data: DailyHabitData,
	app: App,
	file: TFile | null,
): void {
	const currentValue = entry?.value ?? 0;
	const isCompleted = entry?.completed ?? false;
	const isBooleanHabit = habit.target === 1 && habit.unit.singular === "" && habit.unit.plural === "";

	const progressPercent = isBooleanHabit
		? (isCompleted ? MAX_PROGRESS_PERCENT : 0)
		: Math.min(MAX_PROGRESS_PERCENT, Math.round((currentValue / habit.target) * MAX_PROGRESS_PERCENT));

	const card = container.createDiv({
		cls: `habit-tracker-card${isCompleted ? " completed" : ""}${habit.fullWidth ? " full-width" : ""}`,
	});
	card.style.setProperty("--progress", `${progressPercent}%`);

	// -- Left side: name + progress label --
	const infoEl = card.createDiv({ cls: "habit-tracker-card-info" });

	const nameLink = infoEl.createEl("a", {
		text: habit.name,
		cls: "habit-tracker-card-name internal-link",
		attr: { "data-href": habit.name },
	});
	nameLink.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		app.workspace.openLinkText(habit.name, habit.filePath);
	});

	if (isBooleanHabit) {
		const progressEl = infoEl.createDiv({
			cls: `habit-tracker-card-progress${isCompleted ? " done" : ""}`,
		});
		const iconSpan = progressEl.createEl("span", { cls: "habit-tracker-icon" });
		setIcon(iconSpan, isCompleted ? "circle-check" : "circle-x");
		progressEl.createEl("span", { text: isCompleted ? " Done" : " Not done" });
	} else {
		const unitLabel = formatUnit(habit.unit, habit.target);
		infoEl.createEl("span", {
			text: `${currentValue} / ${habit.target} ${unitLabel}`,
			cls: "habit-tracker-card-progress",
		});
	}

	// -- Right side: inline controls --
	const controlsEl = card.createDiv({ cls: "habit-tracker-card-controls" });

	if (isBooleanHabit) {
		const checkbox = controlsEl.createEl("input", {
			type: "checkbox",
			cls: "habit-tracker-checkbox",
		});
		(checkbox as HTMLInputElement).checked = isCompleted;
		checkbox.addEventListener("click", (e) => e.stopPropagation());
		checkbox.addEventListener("change", async (e) => {
			e.stopPropagation();
			const checked = (checkbox as HTMLInputElement).checked;
			await persistEntry(data, {
				habit: habit.name,
				value: checked ? 1 : 0,
				completed: checked,
			}, app, file);
		});
	} else {
		const minusBtn = controlsEl.createEl("button", {
			text: "\u2212",
			cls: "habit-tracker-card-btn",
			attr: { "aria-label": "Decrease value" },
		});
		const plusBtn = controlsEl.createEl("button", {
			text: "+",
			cls: "habit-tracker-card-btn",
			attr: { "aria-label": "Increase value" },
		});

		const updateValue = async (delta: number, e: Event) => {
			e.stopPropagation();
			const current = findEntry(data, habit.name)?.value ?? currentValue;
			const newValue = Math.max(MIN_VALUE, current + delta);
			await persistEntry(data, {
				habit: habit.name,
				value: newValue,
				completed: newValue >= habit.target,
			}, app, file);
		};

		minusBtn.addEventListener("click", (e) => updateValue(-STEP, e));
		plusBtn.addEventListener("click", (e) => updateValue(STEP, e));
	}

	// -- Drag to adjust (non-boolean only) --
	if (!isBooleanHabit) {
		setupDragToAdjust(card, habit, data, app, file);
	}

	// -- Click on info area to open modal --
	infoEl.addEventListener("click", (e) => {
		if (card.dataset["dragged"] === "true") {
			card.dataset["dragged"] = "false";
			return;
		}
		e.preventDefault();
		new HabitDetailModal(app, habit, data, file).open();
	});
}

/**
 * Allow horizontal drag on a card to adjust its value.
 * Dragging right increases, dragging left decreases.
 */
function setupDragToAdjust(
	card: HTMLElement,
	habit: HabitMeta,
	data: DailyHabitData,
	app: App,
	file: TFile | null,
): void {
	const DRAG_THRESHOLD = 5;
	const PIXELS_PER_STEP = 15;

	let isDragging = false;
	let isTracking = false;
	let startX = 0;
	let startValue = 0;
	let activePointerId = -1;

	const onPointerDown = (e: PointerEvent) => {
		// Don't initiate drag from control buttons
		if ((e.target as HTMLElement).closest(".habit-tracker-card-controls")) return;
		isDragging = false;
		isTracking = true;
		activePointerId = e.pointerId;
		startX = e.clientX;
		const entry = findEntry(data, habit.name);
		startValue = entry?.value ?? 0;
	};

	const onPointerMove = (e: PointerEvent) => {
		if (!isTracking || e.pointerId !== activePointerId) return;
		const deltaX = e.clientX - startX;

		if (!isDragging && Math.abs(deltaX) > DRAG_THRESHOLD) {
			isDragging = true;
			card.setPointerCapture(e.pointerId);
			card.addClass("dragging");
		}

		if (isDragging) {
			const steps = Math.round(deltaX / PIXELS_PER_STEP);
			const newValue = Math.max(MIN_VALUE, startValue + steps);
			const percent = Math.min(MAX_PROGRESS_PERCENT, Math.round((newValue / habit.target) * MAX_PROGRESS_PERCENT));
			card.style.setProperty("--progress", `${percent}%`);

			// Update the label live
			const unitLabel = formatUnit(habit.unit, habit.target);
			const label = card.querySelector(".habit-tracker-card-progress");
			if (label) label.setText(`${newValue} / ${habit.target} ${unitLabel}`);

			card.dataset["pendingValue"] = String(newValue);
		}
	};

	const onPointerUp = async (e: PointerEvent) => {
		if (e.pointerId !== activePointerId) return;
		isTracking = false;
		activePointerId = -1;

		if (isDragging) {
			card.releasePointerCapture(e.pointerId);
			card.removeClass("dragging");
			card.dataset["dragged"] = "true";
			const newValue = parseInt(card.dataset["pendingValue"] ?? "0", 10);
			const updatedEntry: HabitEntry = {
				habit: habit.name,
				value: newValue,
				completed: newValue >= habit.target,
			};
			const updatedData = upsertEntry(data, updatedEntry);
			await writeDataToFile(app, file, updatedData);
		}
	};

	card.addEventListener("pointerdown", onPointerDown);
	card.addEventListener("pointermove", onPointerMove);
	card.addEventListener("pointerup", onPointerUp);
}

// ============================================================
// Heatmap view (GitHub-style contribution graph per habit)
// ============================================================

/** Number of progress levels for the heatmap color scale (0 = empty, 1–10 = accent hues) */
const HEATMAP_LEVELS = 10;
const DAYS_PER_WEEK = 7;

function renderHeatmapView(
	container: HTMLElement,
	activeHabits: HabitMeta[],
	data: DailyHabitData,
	app: App,
	settings: HabitTrackerSettings,
): void {
	// Show a loading state, then scan history async
	const wrapper = container.createDiv({ cls: "habit-tracker-heatmap-view" });
	wrapper.createEl("p", { text: "Loading history\u2026", cls: "habit-tracker-heatmap-loading" });

	scanHistory(app, settings.dailyNotesFolder).then((allData) => {
		wrapper.empty();
		for (const habit of activeHabits) {
			renderHabitHeatmap(wrapper, habit, allData, data.date, app, settings);
		}
	});
}

function renderHabitHeatmap(
	container: HTMLElement,
	habit: HabitMeta,
	allData: Map<string, DailyHabitData>,
	currentDate: string,
	app: App,
	settings: HabitTrackerSettings,
): void {
	const block = container.createDiv({ cls: "habit-tracker-heatmap-block" });

	// Habit name as link
	const nameLink = block.createEl("a", {
		text: habit.name,
		cls: "habit-tracker-heatmap-name internal-link",
		attr: { "data-href": habit.name },
	});
	nameLink.addEventListener("click", (e) => {
		e.preventDefault();
		app.workspace.openLinkText(habit.name, habit.filePath);
	});

	// Compute how many columns fit. We use a fixed estimate since we
	// don't know the container width at render time. Obsidian note width
	// is typically ~700px; with 12px cells + 2px gap = 14px per column.
	const CELL_SIZE_WITH_GAP = 14;
	const ESTIMATED_WIDTH = 700;
	const maxColumns = Math.floor(ESTIMATED_WIDTH / CELL_SIZE_WITH_GAP);

	const dates = generateDateRange(currentDate, maxColumns);
	const today = toISODate(new Date());

	// Grid: 7 rows (Mon–Sun) × N columns (weeks)
	const grid = block.createDiv({ cls: "habit-tracker-heatmap-grid" });
	const totalColumns = Math.ceil(dates.length / DAYS_PER_WEEK);
	grid.style.setProperty("--heatmap-columns", String(totalColumns));

	for (const date of dates) {
		const isFuture = date > today;

		if (isFuture) {
			// Future dates are invisible placeholders to keep the grid aligned
			grid.createDiv({ cls: "habit-tracker-heatmap-cell future" });
			continue;
		}

		const isActive = date >= habit.startDate && (habit.endDate === null || date <= habit.endDate);
		const progress = isActive
			? getHabitProgress(allData, habit.name, habit.target, date)
			: undefined;

		let cls = "habit-tracker-heatmap-cell";
		if (!isActive) {
			// Outside habit range — show as neutral grey square
			cls += " no-note";
		} else if (progress === undefined) {
			// No daily note for this date
			cls += " no-note";
		} else if (progress === null || progress === 0) {
			// Daily note exists but no entry or zero progress
			cls += " empty";
		} else {
			// Has progress: map 1–100 to level 1–10
			const level = Math.min(HEATMAP_LEVELS, Math.max(1, Math.ceil(progress / HEATMAP_LEVELS)));
			cls += ` level-${level}`;
		}

		const cell = grid.createDiv({ cls });

		// Tooltip
		const formattedDate = formatShortDate(date);
		const isBooleanHabit = habit.target === 1 && habit.unit.singular === "" && habit.unit.plural === "";

		let tooltip: string;
		if (!isActive) {
			tooltip = `${formattedDate}: not active`;
		} else if (progress === undefined) {
			tooltip = `${formattedDate}: no note`;
		} else if (progress === null || progress === 0) {
			tooltip = `${formattedDate}: not tracked`;
		} else if (isBooleanHabit) {
			tooltip = `${formattedDate}: done`;
		} else {
			tooltip = `${formattedDate}: ${progress}%`;
		}
		cell.setAttribute("aria-label", tooltip);
		cell.setAttribute("title", tooltip);

		// Click to open the daily note for this date
		cell.addClass("clickable");
		cell.addEventListener("click", () => {
			const dailyNotePath = `${settings.dailyNotesFolder}/${date}`;
			app.workspace.openLinkText(dailyNotePath, "");
		});
	}
}

function formatShortDate(dateStr: string): string {
	try {
		const date = new Date(dateStr + "T00:00:00");
		return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	} catch {
		return dateStr;
	}
}

// ============================================================
// Shared: section headers, summary, persistence
// ============================================================

const WIKI_LINK_PATTERN = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

function renderSectionHeader(
	sectionEl: HTMLElement,
	sectionName: string,
	habits: HabitMeta[],
	data: DailyHabitData,
	app: App,
	file: TFile | null,
): void {
	const sectionProgress = computeSectionProgress(habits, data);

	// Collapsed summary (hidden by default)
	const collapsedSummary = sectionEl.createDiv({ cls: "habit-tracker-section-collapsed" });
	renderCollapsedSummary(collapsedSummary, sectionProgress);

	// Header
	const headerEl = sectionEl.createDiv({ cls: "habit-tracker-section-header" });
	const toggleEl = headerEl.createEl("span", {
		cls: "habit-tracker-section-toggle",
		attr: { "aria-label": "Toggle section" },
	});
	const titleEl = headerEl.createEl("h4", { cls: "habit-tracker-section-title" });
	renderSectionTitle(titleEl, sectionName, app);

	// Edit button (pencil icon)
	const editBtn = headerEl.createEl("button", {
		cls: "habit-tracker-section-edit",
		attr: { "aria-label": "Edit section order and display" },
	});
	setIcon(editBtn.createSpan(), "pencil");
	editBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		const onSave = () => {
			// Force re-render of the active markdown preview
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				view.previewMode.rerender(true);
			}
		};
		new SectionEditorModal(app, sectionName, habits, onSave).open();
	});

	sectionEl.prepend(headerEl);

	headerEl.addEventListener("click", (e) => {
		if ((e.target as HTMLElement).closest("a")) return;
		if ((e.target as HTMLElement).closest(".habit-tracker-section-edit")) return;
		const isFolded = sectionEl.hasClass("folded");
		sectionEl.toggleClass("folded", !isFolded);
		toggleEl.setText(!isFolded ? "\u25B6" : "\u25BC");
	});
	toggleEl.setText("\u25BC");
}

function renderSectionTitle(container: HTMLElement, raw: string, app: App): void {
	const match = raw.match(WIKI_LINK_PATTERN);
	if (!match) {
		container.setText(raw);
		return;
	}
	const linkTarget = match[1] ?? "";
	const displayText = match[2] ?? linkTarget;
	const link = container.createEl("a", {
		text: displayText,
		cls: "internal-link",
		attr: { "data-href": linkTarget },
	});
	link.addEventListener("click", (e) => {
		e.preventDefault();
		app.workspace.openLinkText(linkTarget, "");
	});
}

interface SectionProgress {
	completedCount: number;
	totalCount: number;
	percent: number;
}

function computeSectionProgress(habits: HabitMeta[], data: DailyHabitData): SectionProgress {
	let completedCount = 0;
	let totalValue = 0;
	let totalTarget = 0;

	for (const habit of habits) {
		const entry = findEntry(data, habit.name);
		if (entry?.completed) completedCount++;
		totalValue += entry?.value ?? 0;
		totalTarget += habit.target;
	}

	const percent = totalTarget > 0
		? Math.min(MAX_PROGRESS_PERCENT, Math.round((totalValue / totalTarget) * MAX_PROGRESS_PERCENT))
		: 0;

	return { completedCount, totalCount: habits.length, percent };
}

function renderCollapsedSummary(container: HTMLElement, progress: SectionProgress): void {
	const row = container.createDiv({ cls: "habit-tracker-section-progress" });
	row.style.setProperty("--progress", `${progress.percent}%`);

	const allDone = progress.completedCount === progress.totalCount;
	const labelEl = row.createEl("span", {
		cls: `habit-tracker-section-progress-label${allDone ? " all-done" : ""}`,
	});
	if (allDone) {
		const iconSpan = labelEl.createEl("span", { cls: "habit-tracker-icon" });
		setIcon(iconSpan, "check");
	}
	labelEl.appendText(` ${progress.completedCount}/${progress.totalCount} completed`);
}

function renderSummary(el: HTMLElement, activeHabits: HabitMeta[], data: DailyHabitData): void {
	const completedCount = activeHabits.filter(h => findEntry(data, h.name)?.completed === true).length;
	const totalCount = activeHabits.length;
	const allDone = completedCount === totalCount;

	const summary = el.createDiv({ cls: "habit-tracker-summary" });
	const statusEl = summary.createEl("span", {
		cls: `habit-tracker-status${allDone ? " all-done" : ""}`,
	});
	if (allDone) {
		const iconSpan = statusEl.createEl("span", { cls: "habit-tracker-icon" });
		setIcon(iconSpan, "check");
	}
	statusEl.appendText(` ${completedCount}/${totalCount} habits completed`);
}

async function persistEntry(
	data: DailyHabitData,
	entry: HabitEntry,
	app: App,
	file: TFile | null,
): Promise<void> {
	const updatedData = upsertEntry(data, entry);
	await writeDataToFile(app, file, updatedData);
}

// ============================================================
// Icons (inline SVGs for the view toggle)
// ============================================================


