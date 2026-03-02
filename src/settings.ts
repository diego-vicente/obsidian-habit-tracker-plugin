import { App, PluginSettingTab, Setting } from "obsidian";
import type HabitTrackerPlugin from "./main";

export interface HabitTrackerSettings {
	/** Folder path where daily notes are stored (relative to vault root) */
	dailyNotesFolder: string;
}

const DEFAULT_DAILY_NOTES_FOLDER = "Personal/Journal";

export const DEFAULT_SETTINGS: HabitTrackerSettings = {
	dailyNotesFolder: DEFAULT_DAILY_NOTES_FOLDER,
};

export class HabitTrackerSettingTab extends PluginSettingTab {
	plugin: HabitTrackerPlugin;

	constructor(app: App, plugin: HabitTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Habit Tracker settings" });

		new Setting(containerEl)
			.setName("Daily notes folder")
			.setDesc("The folder path where your daily notes are stored (e.g. \"Personal/Journal\").")
			.addText(text =>
				text
					.setPlaceholder(DEFAULT_DAILY_NOTES_FOLDER)
					.setValue(this.plugin.settings.dailyNotesFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotesFolder = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
