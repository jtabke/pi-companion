import { common, createLowlight } from "lowlight";
import { useMemo, type ReactNode } from "react";

const lowlight = createLowlight(common);
const aliases: Record<string, string> = {
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescript",
	jsonc: "json",
	zsh: "bash",
};
type HighlightNode = ReturnType<typeof lowlight.highlight>["children"][number];

function render(nodes: readonly HighlightNode[]): ReactNode {
	return nodes.map((node, index) => {
		if (node.type === "text") return node.value;
		if (node.type !== "element") return null;
		const classes = node.properties.className;
		return (
			<span
				key={index}
				className={
					Array.isArray(classes)
						? classes.filter((value) => typeof value === "string").join(" ")
						: undefined
				}
			>
				{render(node.children)}
			</span>
		);
	});
}

/** Language fences and native file paths are hints, never executable HTML. */
export function CodeText({
	text,
	language,
}: {
	text: string;
	language?: string;
}) {
	return useMemo(() => {
		const hint = language
			?.toLowerCase()
			.split(/[\s{]/)[0]
			?.split(/[/\\]/)
			.pop();
		const extension = hint?.includes(".") ? hint.split(".").pop() : hint;
		const name = extension ? (aliases[extension] ?? extension) : undefined;
		if (!name || !lowlight.registered(name) || text.length > 100_000)
			return text;
		try {
			return render(lowlight.highlight(name, text).children);
		} catch {
			return text;
		}
	}, [text, language]);
}

export function DiffText({
	text,
	language,
}: {
	text: string;
	language?: string;
}) {
	return (
		<code>
			{text.split("\n").map((line, index, lines) => {
				const prefix =
					/^[ +-]\s*\d+ /.exec(line)?.[0] ?? /^[ +-]/.exec(line)?.[0] ?? "";
				return (
					<span
						key={index}
						className={
							line.startsWith("+")
								? "diff-added"
								: line.startsWith("-")
									? "diff-deleted"
									: "diff-context"
						}
					>
						{prefix}
						<CodeText
							text={line.slice(prefix.length)}
							language={text.length <= 100_000 ? language : undefined}
						/>
						{index < lines.length - 1 ? "\n" : ""}
					</span>
				);
			})}
		</code>
	);
}
