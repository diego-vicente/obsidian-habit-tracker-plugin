import { App, Modal, TFile, setIcon } from "obsidian";
import type { HabitMeta } from "./types";
import { SPAN_DEFAULT, SPAN_HALF, SPAN_FULL } from "./types";
import { resolveSectionFile } from "./habits";

interface HabitDisplayConfig {
	name: string;
	filePath: string;
	span: number;
	spanMobile: number | null;
}

/** Sentinel value for the mobile selector meaning "same as desktop" */
const INHERIT_SENTINEL = -999;

/** Options for the span selectors */
const SPAN_OPTIONS: { value: number; label: string }[] = [
	{ value: SPAN_DEFAULT, label: "1 col" },
	{ value: SPAN_HALF, label: "Half" },
	{ value: 2, label: "2 col" },
	{ value: SPAN_FULL, label: "Full" },
];

/** Options for the mobile span selector (includes "inherit" option) */
const MOBILE_SPAN_OPTIONS: { value: number; label: string }[] = [
	{ value: INHERIT_SENTINEL, label: "—" },
	...SPAN_OPTIONS,
];

/**
 * Modal to edit the order and display settings of habits within a section.
 * - Reorder habits via up/down buttons
 * - Set column span per habit for desktop and mobile
 * - Saves `order` list to the section note's frontmatter
 * - Saves `span` and `span_mobile` to each habit note's frontmatter
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
			span: h.span,
			spanMobile: h.spanMobile,
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
			text: "Reorder habits and set column span. Mobile defaults to desktop if set to \u2014.",
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

		// Column headers
		const headerRow = this.listEl.createDiv({ cls: "section-editor-header" });
		headerRow.createEl("span"); // spacer for move buttons
		headerRow.createEl("span", { text: "Habit", cls: "section-editor-col-label" });
		headerRow.createEl("span", { text: "Desktop", cls: "section-editor-col-label" });
		headerRow.createEl("span", { text: "Mobile", cls: "section-editor-col-label" });

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

		// Desktop span selector
		row.appendChild(this.createSpanSelect(
			SPAN_OPTIONS,
			item.span,
			(val) => { item.span = val; },
			"Desktop span",
		));

		// Mobile span selector
		const mobileValue = item.spanMobile ?? INHERIT_SENTINEL;
		row.appendChild(this.createSpanSelect(
			MOBILE_SPAN_OPTIONS,
			mobileValue,
			(val) => { item.spanMobile = val === INHERIT_SENTINEL ? null : val; },
			"Mobile span",
		));
	}

	private createSpanSelect(
		options: { value: number; label: string }[],
		currentValue: number,
		onChange: (val: number) => void,
		ariaLabel: string,
	): HTMLElement {
		const wrapper = createDiv({ cls: "section-editor-span" });
		const select = wrapper.createEl("select", {
			cls: "section-editor-span-select",
			attr: { "aria-label": ariaLabel },
		});

		for (const opt of options) {
			const option = select.createEl("option", {
				text: opt.label,
				attr: { value: String(opt.value) },
			});
			if (opt.value === currentValue) {
				(option as HTMLOptionElement).selected = true;
			}
		}

		select.addEventListener("change", () => {
			onChange(parseFloat(select.value));
		});

		return wrapper;
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

		// 2. Write `span` and `span_mobile` to each habit note
		for (const item of this.items) {
			await this.saveSpanToHabit(item);
		}
	}

	private async saveOrderToSection(): Promise<void> {
		const file = resolveSectionFile(this.app, this.sectionName);
		if (!file) return;

		const order = this.items.map(item => item.name);
		await this.updateFrontmatterProperty(file, "order", order);
	}

	private async saveSpanToHabit(item: HabitDisplayConfig): Promise<void> {
		const abstractFile = this.app.vault.getAbstractFileByPath(item.filePath);
		if (!(abstractFile instanceof TFile)) return;

		// Desktop span
		if (item.span === SPAN_DEFAULT) {
			await this.removeFrontmatterProperty(abstractFile, "span");
			await this.removeFrontmatterProperty(abstractFile, "full_width");
		} else {
			await this.updateFrontmatterProperty(abstractFile, "span", serializeSpan(item.span));
			await this.removeFrontmatterProperty(abstractFile, "full_width");
		}

		// Mobile span
		if (item.spanMobile === null) {
			await this.removeFrontmatterProperty(abstractFile, "span_mobile");
		} else {
			await this.updateFrontmatterProperty(abstractFile, "span_mobile", serializeSpan(item.spanMobile));
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

/**
 * Convert a numeric span value to its frontmatter representation.
 */
function serializeSpan(span: number): string | number {
	if (span === SPAN_FULL) return "full";
	if (span === SPAN_HALF) return "half";
	return span;
}

const WIKI_LINK_DISPLAY = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

function displaySectionName(raw: string): string {
	const match = raw.match(WIKI_LINK_DISPLAY);
	if (match) return match[2] ?? match[1] ?? raw;
	return raw;
}
