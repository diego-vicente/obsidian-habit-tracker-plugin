import { App, Modal, TFile, setIcon } from "obsidian";
import type { HabitMeta } from "./types";
import { resolveSectionFile } from "./habits";

interface HabitDisplayConfig {
	name: string;
	filePath: string;
	fullWidth: boolean;
}

/**
 * Modal to edit the order and display settings of habits within a section.
 * - Reorder habits via up/down buttons
 * - Toggle full_width per habit
 * - Saves `order` list to the section note's frontmatter
 * - Saves `full_width` to each habit note's frontmatter
 */
export class SectionEditorModal extends Modal {
	private sectionName: string;
	private items: HabitDisplayConfig[];
	private listEl: HTMLElement | null = null;
	private onSave: (() => void) | null;

	constructor(app: App, sectionName: string, habits: HabitMeta[], onSave?: () => void) {
		super(app);
		this.sectionName = sectionName;
		this.onSave = onSave ?? null;
		this.items = habits.map(h => ({
			name: h.name,
			filePath: h.filePath,
			fullWidth: h.fullWidth,
		}));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("section-editor-modal");

		// Title
		contentEl.createEl("h3", { text: `Edit: ${displaySectionName(this.sectionName)}` });

		// Instructions
		contentEl.createEl("p", {
			text: "Reorder habits and toggle full-width display.",
			cls: "section-editor-hint",
		});

		// List
		this.listEl = contentEl.createDiv({ cls: "section-editor-list" });
		this.renderList();

		// Save button
		const footer = contentEl.createDiv({ cls: "section-editor-footer" });
		const saveBtn = footer.createEl("button", {
			text: "Save",
			cls: "mod-cta",
		});
		saveBtn.addEventListener("click", async () => {
			await this.save();
			this.close();
			this.onSave?.();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderList(): void {
		if (!this.listEl) return;
		this.listEl.empty();

		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			if (!item) continue;
			this.renderItem(this.listEl, item, i);
		}
	}

	private renderItem(container: HTMLElement, item: HabitDisplayConfig, index: number): void {
		const row = container.createDiv({ cls: "section-editor-item" });

		// Move buttons
		const moveCol = row.createDiv({ cls: "section-editor-move" });

		const upBtn = moveCol.createEl("button", {
			cls: "section-editor-move-btn",
			attr: { "aria-label": "Move up" },
		});
		setIcon(upBtn.createSpan(), "chevron-up");
		if (index === 0) upBtn.setAttribute("disabled", "true");
		upBtn.addEventListener("click", () => {
			if (index > 0) {
				this.swap(index, index - 1);
				this.renderList();
			}
		});

		const downBtn = moveCol.createEl("button", {
			cls: "section-editor-move-btn",
			attr: { "aria-label": "Move down" },
		});
		setIcon(downBtn.createSpan(), "chevron-down");
		const lastIndex = this.items.length - 1;
		if (index === lastIndex) downBtn.setAttribute("disabled", "true");
		downBtn.addEventListener("click", () => {
			if (index < lastIndex) {
				this.swap(index, index + 1);
				this.renderList();
			}
		});

		// Habit name
		row.createEl("span", { text: item.name, cls: "section-editor-name" });

		// Full-width toggle
		const toggleCol = row.createDiv({ cls: "section-editor-toggle" });
		const toggleLabel = toggleCol.createEl("label", { cls: "section-editor-toggle-label" });

		const checkbox = toggleLabel.createEl("input", { type: "checkbox" });
		(checkbox as HTMLInputElement).checked = item.fullWidth;
		checkbox.addEventListener("change", () => {
			item.fullWidth = (checkbox as HTMLInputElement).checked;
		});

		toggleLabel.createEl("span", { text: "Full width" });
	}

	private swap(indexA: number, indexB: number): void {
		const a = this.items[indexA];
		const b = this.items[indexB];
		if (a && b) {
			this.items[indexA] = b;
			this.items[indexB] = a;
		}
	}

	private async save(): Promise<void> {
		// 1. Write `order` to the section note
		await this.saveOrderToSection();

		// 2. Write `full_width` to each habit note
		for (const item of this.items) {
			await this.saveFullWidthToHabit(item);
		}
	}

	private async saveOrderToSection(): Promise<void> {
		const file = resolveSectionFile(this.app, this.sectionName);
		if (!file) return;

		const order = this.items.map(item => item.name);
		await this.updateFrontmatterProperty(file, "order", order);
	}

	private async saveFullWidthToHabit(item: HabitDisplayConfig): Promise<void> {
		const abstractFile = this.app.vault.getAbstractFileByPath(item.filePath);
		if (!(abstractFile instanceof TFile)) return;

		if (item.fullWidth) {
			await this.updateFrontmatterProperty(abstractFile, "full_width", true);
		} else {
			await this.removeFrontmatterProperty(abstractFile, "full_width");
		}
	}

	/**
	 * Update a single frontmatter property in a file.
	 * Uses processFrontMatter for safe YAML manipulation.
	 */
	private async updateFrontmatterProperty(
		file: TFile,
		key: string,
		value: unknown,
	): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm[key] = value;
		});
	}

	/**
	 * Remove a frontmatter property from a file.
	 */
	private async removeFrontmatterProperty(
		file: TFile,
		key: string,
	): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			delete fm[key];
		});
	}
}

const WIKI_LINK_DISPLAY = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

function displaySectionName(raw: string): string {
	const match = raw.match(WIKI_LINK_DISPLAY);
	if (match) return match[2] ?? match[1] ?? raw;
	return raw;
}
