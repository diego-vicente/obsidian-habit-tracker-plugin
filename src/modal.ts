import { App, Modal, TFile } from "obsidian";
import type { HabitMeta, HabitEntry, DailyHabitData } from "./types";
import { formatUnit } from "./types";
import { findEntry, upsertEntry, serializeDailyHabitData } from "./parser";
import { writeDataToFile } from "./file-utils";

const MIN_VALUE = 0;
const STEP = 1;

/**
 * Modal for editing a single habit's daily progress.
 * Shows the habit name (link), target, +/- buttons, input, and a save action.
 */
export class HabitDetailModal extends Modal {
	private habit: HabitMeta;
	private data: DailyHabitData;
	private file: TFile | null;
	private currentValue: number;
	private isCompleted: boolean;
	private isBooleanHabit: boolean;

	constructor(
		app: App,
		habit: HabitMeta,
		data: DailyHabitData,
		file: TFile | null,
	) {
		super(app);
		this.habit = habit;
		this.data = data;
		this.file = file;

		const entry = findEntry(data, habit.name);
		this.currentValue = entry?.value ?? 0;
		this.isCompleted = entry?.completed ?? false;
		this.isBooleanHabit = habit.target === 1 && habit.unit.singular === "" && habit.unit.plural === "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("habit-modal");

		// -- Header: habit name as link --
		const header = contentEl.createDiv({ cls: "habit-modal-header" });
		const nameLink = header.createEl("a", {
			text: this.habit.name,
			cls: "habit-modal-name internal-link",
			attr: { "data-href": this.habit.name },
		});
		nameLink.addEventListener("click", (e) => {
			e.preventDefault();
			this.app.workspace.openLinkText(this.habit.name, this.habit.filePath);
			this.close();
		});

		// -- Target info --
		if (!this.isBooleanHabit) {
			const targetLabel = formatUnit(this.habit.unit, this.habit.target);
			header.createEl("span", {
				text: `Target: ${this.habit.target} ${targetLabel}`,
				cls: "habit-modal-target",
			});
		}

		// -- Control area --
		const controlEl = contentEl.createDiv({ cls: "habit-modal-control" });

		if (this.isBooleanHabit) {
			this.renderBooleanControl(controlEl);
		} else {
			this.renderValueControl(controlEl);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderBooleanControl(container: HTMLElement): void {
		const row = container.createDiv({ cls: "habit-modal-boolean-row" });

		const checkbox = row.createEl("input", {
			type: "checkbox",
			cls: "habit-modal-checkbox",
		});
		(checkbox as HTMLInputElement).checked = this.isCompleted;

		row.createEl("span", {
			text: this.isCompleted ? "Completed" : "Not completed",
			cls: "habit-modal-boolean-label",
		});

		checkbox.addEventListener("change", async () => {
			const checked = (checkbox as HTMLInputElement).checked;
			this.currentValue = checked ? 1 : 0;
			this.isCompleted = checked;
			row.querySelector(".habit-modal-boolean-label")?.setText(
				checked ? "Completed" : "Not completed",
			);
			await this.persist();
		});
	}

	private renderValueControl(container: HTMLElement): void {
		const unitLabel = formatUnit(this.habit.unit, this.habit.target);

		const row = container.createDiv({ cls: "habit-modal-value-row" });

		// Minus button
		const minusBtn = row.createEl("button", {
			text: "\u2212",
			cls: "habit-tracker-btn",
			attr: { "aria-label": "Decrease value" },
		});

		// Input
		const input = row.createEl("input", {
			type: "number",
			cls: "habit-modal-input",
			attr: { min: String(MIN_VALUE), value: String(this.currentValue) },
		});

		// Label
		row.createEl("span", {
			text: `/ ${this.habit.target} ${unitLabel}`,
			cls: "habit-modal-target-label",
		});

		// Plus button
		const plusBtn = row.createEl("button", {
			text: "+",
			cls: "habit-tracker-btn",
			attr: { "aria-label": "Increase value" },
		});

		const updateValue = async (newValue: number) => {
			const clamped = Math.max(MIN_VALUE, newValue);
			this.currentValue = clamped;
			this.isCompleted = clamped >= this.habit.target;
			input.value = String(clamped);
			await this.persist();
		};

		minusBtn.addEventListener("click", () => {
			updateValue((parseFloat(input.value) || 0) - STEP);
		});

		plusBtn.addEventListener("click", () => {
			updateValue((parseFloat(input.value) || 0) + STEP);
		});

		input.addEventListener("change", () => {
			updateValue(parseFloat(input.value) || 0);
		});
	}

	private async persist(): Promise<void> {
		const entry: HabitEntry = {
			habit: this.habit.name,
			value: this.currentValue,
			completed: this.isCompleted,
		};
		this.data = upsertEntry(this.data, entry);
		await writeDataToFile(this.app, this.file, this.data);
	}
}
