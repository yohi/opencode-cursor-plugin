import { createHash } from "node:crypto";

export type PromptPart =
	| { type: "text"; text: string }
	| { type: string; [key: string]: unknown };

export type PromptMessage =
	| { role: "system"; content: string | PromptPart[] }
	| { role: "user" | "assistant" | "tool"; content: string | PromptPart[] };

export type ModelV2Prompt = PromptMessage[];

export interface TranslatedRequest {
	prefixHash: string;
	latestUserMessage: string;
	fullPromptOnMiss: string;
	nextHash: string;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function extractText(message: PromptMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}

	return message.content
		.map((part) => {
			if (part.type === "text") return (part as { text: string }).text;
			const p = part as Record<string, unknown>;
			const id =
				(p.id as string | undefined) ||
				(p.name as string | undefined) ||
				(p.url as string | undefined) ||
				"unknown";
			return `[${part.type}:${id}]`;
		})
		.join("");
}

function hashMessages(messages: PromptMessage[]): string {
	const hash = createHash("sha256");

	for (const message of messages) {
		if (message.role !== "system" && message.role !== "user") {
			continue;
		}

		hash.update(`${message.role}\u0000${extractText(message)}\u0001`);
	}

	return hash.digest("hex");
}

export function translate(prompt: ModelV2Prompt): TranslatedRequest {
	if (prompt.length === 0) {
		throw new Error("translate: prompt is empty");
	}

	const last = prompt[prompt.length - 1];
	if (!last || last.role !== "user") {
		throw new Error("translate: last message must be user");
	}

	const latestUserMessage = extractText(last);
	const prefixHash = hashMessages(prompt.slice(0, -1));
	const nextHash = hashMessages(prompt);

	// 履歴がない（最初のターン）の場合は、XMLタグを付与せず生のテキストを送信する
	const fullPromptOnMiss =
		prompt.length === 1
			? latestUserMessage
			: prompt
					.map(
						(message) =>
							`<${message.role}>${escapeHtml(extractText(message))}</${message.role}>`,
					)
					.join("\n");

	return {
		prefixHash,
		latestUserMessage,
		fullPromptOnMiss,
		nextHash,
	};
}
