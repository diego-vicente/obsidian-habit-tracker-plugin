import { App, TFile } from "obsidian";
import { CODE_BLOCK_LANGUAGE } from "./types";
import { serializeDailyHabitData } from "./parser";
import type { DailyHabitData } from "./types";

/**
 * Write updated habit data back to the code block in the source file.
 */
export async function writeDataToFile(
	app: App,
	file: TFile | null,
	data: DailyHabitData,
): Promise<void> {
	if (!file) return;

	const content = await app.vault.read(file);
	const updatedContent = replaceCodeBlockContent(content, serializeDailyHabitData(data));

	if (updatedContent !== null) {
		await app.vault.modify(file, updatedContent);
	}
}

/**
 * Replace the content of the first ```dvicente-habit-tracker code block in the file.
 * Returns the updated file content, or null if the block was not found.
 */
function replaceCodeBlockContent(
	fileContent: string,
	newBlockContent: string,
): string | null {
	const openTag = "```" + CODE_BLOCK_LANGUAGE;
	const closeTag = "```";

	const startIndex = fileContent.indexOf(openTag);
	if (startIndex < 0) return null;

	const contentStart = startIndex + openTag.length;
	const endIndex = fileContent.indexOf(closeTag, contentStart);
	if (endIndex < 0) return null;

	return (
		fileContent.substring(0, contentStart) +
		"\n" +
		newBlockContent +
		"\n" +
		fileContent.substring(endIndex)
	);
}
