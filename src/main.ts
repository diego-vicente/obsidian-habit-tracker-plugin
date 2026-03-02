import { MarkdownPostProcessorContext, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, HabitTrackerSettings, HabitTrackerSettingTab } from "./settings";
import { CODE_BLOCK_LANGUAGE } from "./types";
import { parseDailyHabitData, createEmptyDailyData } from "./parser";
import { extractDateFromFilename } from "./habits";
import { renderHabitTracker } from "./renderer";

export default class HabitTrackerPlugin extends Plugin {
	settings: HabitTrackerSettings;

	async onload() {
		await this.loadSettings();

		// Register the code block processor for ```dvicente-habit-tracker blocks
		this.registerMarkdownCodeBlockProcessor(
			CODE_BLOCK_LANGUAGE,
			(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				this.processHabitTrackerBlock(source, el, ctx);
			},
		);

		// Settings tab
		this.addSettingTab(new HabitTrackerSettingTab(this.app, this));
	}

	onunload() {
		// Nothing to clean up -- registerMarkdownCodeBlockProcessor is
		// automatically unregistered by the Plugin base class.
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<HabitTrackerSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// -- Code block processing --

	private processHabitTrackerBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): void {
		const file = this.resolveSourceFile(ctx);
		const date = this.resolveDateFromContext(ctx, file);

		// Parse existing data, or create empty data for this date
		const data = parseDailyHabitData(source) ?? createEmptyDailyData(date);

		renderHabitTracker(data, el, this.app, file, this.settings);
	}

	/**
	 * Resolve the TFile for the note containing the code block.
	 */
	private resolveSourceFile(ctx: MarkdownPostProcessorContext): TFile | null {
		const sourcePath = ctx.sourcePath;
		const abstractFile = this.app.vault.getAbstractFileByPath(sourcePath);
		return abstractFile instanceof TFile ? abstractFile : null;
	}

	/**
	 * Determine the date for this habit tracker block.
	 * Tries to extract it from the daily note filename (YYYY-MM-DD.md),
	 * then from parsed data, and falls back to today.
	 */
	private resolveDateFromContext(
		ctx: MarkdownPostProcessorContext,
		file: TFile | null,
	): string {
		// Try extracting from the filename (daily note convention)
		if (file) {
			const dateFromName = extractDateFromFilename(file.name);
			if (dateFromName !== null) {
				return dateFromName;
			}
		}

		// Fallback: use today's date
		return todayISO();
	}
}

function todayISO(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
