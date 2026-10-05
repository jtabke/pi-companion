import React, { useState } from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ImagePreview } from "./image-preview.js";
import type { Block, Snapshot } from "../../src/shared/protocol.js";
import { CodeText, DiffText } from "./code.js";

function NativeImage({
	block,
	snapshot,
	imageNumber,
}: {
	block: Extract<Block, { type: "image" }>;
	snapshot: Snapshot;
	imageNumber: number;
}) {
	return (
		<ImagePreview
			src={`/api/media/${snapshot.instance}/${snapshot.generation}/${block.ref}`}
			width={block.width}
			height={block.height}
			alt={`Native Pi image ${imageNumber}`}
			label={`Enlarge native Pi image ${imageNumber}`}
			className="image"
			loading="lazy"
		/>
	);
}
function CopyText({ text, kind }: { text: string; kind: "code" | "answer" }) {
	const [copy, setCopy] = useState<{
		text: string;
		status: "copying" | "copied" | "failed";
	}>();
	async function copyText() {
		if (copy?.status === "copying") return;
		setCopy({ text, status: "copying" });
		try {
			await navigator.clipboard.writeText(text);
			setCopy({ text, status: "copied" });
		} catch {
			setCopy({ text, status: "failed" });
		}
	}
	const status = copy?.text === text ? copy.status : undefined;
	return (
		<>
			<button
				type="button"
				onClick={copyText}
				aria-label={`Copy ${kind}`}
				title={`Copy ${kind}`}
				aria-disabled={copy?.status === "copying"}
			>
				{kind === "answer" ? (
					<svg
						aria-hidden="true"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<rect x="8" y="8" width="12" height="13" rx="2" />
						<path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
					</svg>
				) : (
					"Copy code"
				)}
			</button>
			<span className="code-copy-status" role="status">
				{status === "copied"
					? "Copied"
					: status === "failed"
						? "Copy failed"
						: status === "copying"
							? "Copying…"
							: ""}
			</span>
		</>
	);
}
function CodeBlock({
	children,
	node,
}: React.ComponentProps<"pre"> & ExtraProps) {
	const code = node?.children.find(
		(child) => child.type === "element" && child.tagName === "code",
	);
	const classes =
		code?.type === "element" ? code.properties.className : undefined;
	const language = Array.isArray(classes)
		? classes
				.find(
					(name) => typeof name === "string" && name.startsWith("language-"),
				)
				?.toString()
				.slice(9)
		: undefined;
	const text =
		code?.type === "element"
			? code.children
					.filter((child) => child.type === "text")
					.map((child) => child.value)
					.join("")
			: "";
	return (
		<div className="code-block">
			<div className="code-heading">
				<span>{language || "Code"}</span>
				<CopyText text={text} kind="code" />
			</div>
			<pre tabIndex={0}>
				{text ? (
					<code>
						<CodeText text={text} language={language} />
					</code>
				) : (
					children
				)}
			</pre>
		</div>
	);
}
export function SafeMarkdown({ text }: { text: string }) {
	return (
		<Markdown
			remarkPlugins={[remarkGfm]}
			skipHtml
			components={{
				pre: CodeBlock,
				table: ({ children }) => (
					<div
						className="table-scroll"
						role="region"
						aria-label="Scrollable table"
						tabIndex={0}
						onKeyDown={(event) => {
							if (
								event.target !== event.currentTarget ||
								event.altKey ||
								event.ctrlKey ||
								event.metaKey ||
								event.shiftKey
							)
								return;
							if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
								event.preventDefault();
								event.currentTarget.scrollLeft +=
									event.key === "ArrowRight" ? 40 : -40;
							}
						}}
					>
						<table>{children}</table>
					</div>
				),
				img: () => <span>[External image not loaded]</span>,
				a: ({ children, href }) =>
					href && /^https?:\/\//i.test(href) ? (
						<a href={href} rel="noreferrer noopener" target="_blank">
							{children}
						</a>
					) : (
						<span>{children}</span>
					),
			}}
		>
			{text}
		</Markdown>
	);
}
function ContentBlocks({
	blocks,
	snapshot,
	toolOutput = false,
	sourceText = false,
	language,
	imageOffset = 0,
}: {
	blocks: Block[];
	snapshot: Snapshot;
	toolOutput?: boolean;
	sourceText?: boolean;
	language?: string;
	imageOffset?: number;
}) {
	let imageNumber = imageOffset;
	return (
		<>
			{blocks.map((block, index) => {
				if (block.type === "image")
					return (
						<NativeImage
							key={block.ref}
							block={block}
							snapshot={snapshot}
							imageNumber={++imageNumber}
						/>
					);
				if (block.type === "tool")
					return (
						<p className="tool-call visually-hidden" key={index}>
							{block.text}
						</p>
					);
				if (block.type === "unavailable")
					return (
						<p key={index} role="status">
							{block.text}
						</p>
					);
				const content = (
					<>
						{block.type === "diff" ? (
							<pre
								className="tool-output edit-diff"
								tabIndex={0}
								aria-label="Edit diff"
							>
								<DiffText text={block.text} language={language} />
							</pre>
						) : toolOutput ? (
							<pre className="tool-output" tabIndex={0}>
								<CodeText
									text={block.text}
									language={sourceText ? language : undefined}
								/>
							</pre>
						) : (
							<SafeMarkdown text={block.text} />
						)}
						{block.omittedChars && (
							<p className="preview-note">
								Preview shortened · {block.omittedChars.toLocaleString()}{" "}
								characters omitted.
							</p>
						)}
					</>
				);
				return block.type === "thinking" ? (
					<details key={index} className="thinking-disclosure">
						<summary>Thinking</summary>
						{content}
					</details>
				) : (
					<React.Fragment key={index}>{content}</React.Fragment>
				);
			})}
		</>
	);
}
/** Only exact native tool identities get friendly labels; icons never imply outcomes. */
function ToolLabel({ name }: { name: string }) {
	let label = name;
	let path = "M7 4h10v4H7z M5 8h14v12H5z M9 12h6";
	switch (name) {
		case "read":
		case "functions.read":
			label = "Read";
			path =
				"M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1v15 M6 7h3 M6 10h3 M15 7h3 M15 10h3";
			break;
		case "edit":
		case "functions.edit":
			label = "Edit";
			path = "m4 16 12-12 4 4L8 20H4z M13 7l4 4";
			break;
		case "write":
		case "functions.write":
			label = "Write";
			path =
				"m14 3 7 7-9 9-9 2 2-9z M12 5l7 7 M3 21l7-7 M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2";
			break;
		case "subagent":
		case "functions.subagent":
			label = "Subagent";
			path =
				"M12 3v4 M10 3h4 M5 7h14v13H5z M2 11v5 M22 11v5 M8 11h1 M15 11h1 M9 16h6";
			break;
		case "codemode":
		case "functions.codemode":
			label = "Codemode";
			path = "M7 4H5v5l-2 3 2 3v5h2 M17 4h2v5l2 3-2 3v5h-2 M10 8l6 4-6 4z";
			break;
		case "bash":
		case "functions.bash":
			label = "Shell";
			path = "M3 4h18v16H3z m4 4 4 4-4 4 M13 16h4";
	}
	return (
		<>
			<svg
				className="tool-icon"
				aria-hidden="true"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d={path} />
			</svg>
			<span className="tool-label">{label}</span>
			{label !== name && <span className="visually-hidden"> ({name})</span>}
		</>
	);
}
/** Renders the bounded native conversation; media and Markdown never authorize actions. */
export function Conversation({ snapshot }: { snapshot?: Snapshot }) {
	let imageNumber = 0;
	const conversation: React.ReactNode[] = [];
	let toolStack: React.ReactNode[] | undefined;
	snapshot?.items.forEach((nativeItem) => {
		const item = {
			...nativeItem,
			blocks: nativeItem.blocks.filter(
				(block) =>
					block.type !== "thinking" ||
					!!block.text.trim() ||
					!!block.omittedChars,
			),
		};
		if (!item.blocks.length && !item.tool) return;
		const imageOffset = imageNumber;
		imageNumber += item.blocks.filter((block) => block.type === "image").length;
		const isTool = item.role.startsWith("tool:");
		const codePath =
			item.tool &&
			[
				"read",
				"write",
				"edit",
				"functions.read",
				"functions.write",
				"functions.edit",
			].includes(item.tool.name)
				? item.tool.summary
				: undefined;
		const toolSummary = codePath
			? codePath.split(/[/\\]/).pop() || codePath
			: item.tool?.summary;
		const mediaBlock = (block: Block) =>
			block.type === "image" ||
			(block.type === "unavailable" &&
				block.text.startsWith("Image unavailable:"));
		const output = isTool
			? item.blocks.filter((block) => !mediaBlock(block))
			: [];
		const answer =
			item.role === "assistant"
				? item.blocks
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n\n")
				: "";
		const errorPreview =
			item.tool?.state === "error"
				? output.find((block) => block.type === "text")?.text.slice(0, 240)
				: undefined;
		const shortened = output.some((block) =>
			block.type === "text" ||
			block.type === "thinking" ||
			block.type === "diff"
				? !!block.omittedChars
				: block.type === "unavailable",
		);
		// Tool-call metadata remains accessible, but only actual results get visual rows.
		const onlyToolCalls =
			item.role === "assistant" &&
			item.blocks.length > 0 &&
			item.blocks.every((block) => block.type === "tool");
		const redundantRole =
			(isTool && (!!output.length || !!item.tool)) ||
			item.role === "assistant" ||
			item.role === "user";
		const article = (
			<article
				className={`message message-${item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : "event"}${onlyToolCalls ? " visually-hidden" : ""}`}
				key={item.id}
				data-native-item={item.id}
				aria-label={item.role}
			>
				<h3
					className={`message-role${redundantRole ? " visually-hidden" : ""}`}
				>
					{item.role === "assistant" ? "Pi" : item.role}
				</h3>
				{isTool ? (
					<>
						{(!!output.length || !!item.tool) && (
							<details className="tool-disclosure">
								<summary>
									<ToolLabel
										name={item.tool?.name ?? item.role.slice(6).trimStart()}
									/>
									{item.tool?.summary && (
										<span className="tool-summary" title={item.tool.summary}>
											{toolSummary}
										</span>
									)}
									{item.tool && (
										<span
											className={`tool-state tool-state-${item.tool.state}`}
										>
											{item.tool.state === "error"
												? "Failed"
												: item.tool.state === "running"
													? "Running"
													: "Done"}
										</span>
									)}
									<span className="visually-hidden"> · output</span>
									{shortened ? " · shortened" : ""}
									<svg
										className="tool-chevron"
										aria-hidden="true"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
									>
										<path d="m9 5 7 7-7 7" />
									</svg>
								</summary>
								{item.tool?.summary && (
									<p
										className="tool-detail-summary"
										tabIndex={0}
										aria-label="Tool path or command"
									>
										{item.tool.summary}
									</p>
								)}
								<ContentBlocks
									blocks={output}
									snapshot={snapshot}
									toolOutput
									sourceText={
										item.tool?.name === "read" ||
										item.tool?.name === "functions.read"
									}
									language={codePath}
								/>
							</details>
						)}
						{errorPreview && (
							<p className="tool-error-preview">{errorPreview}</p>
						)}
						<ContentBlocks
							blocks={item.blocks.filter(mediaBlock)}
							snapshot={snapshot}
							imageOffset={imageOffset}
						/>
					</>
				) : (
					<>
						<ContentBlocks
							blocks={item.blocks}
							snapshot={snapshot}
							imageOffset={imageOffset}
						/>
						{answer && (
							<div className="answer-actions">
								<CopyText text={answer} kind="answer" />
							</div>
						)}
					</>
				)}
			</article>
		);
		// A single result owns its stack immediately, so appending cannot reparent disclosures.
		if (isTool) {
			if (!toolStack) {
				toolStack = [];
				conversation.push(
					<div className="tool-stack" key={item.id}>
						{toolStack}
					</div>,
				);
			}
			toolStack.push(article);
		} else {
			toolStack = undefined;
			conversation.push(article);
		}
	});
	return (
		<>
			{(snapshot?.omittedItems ?? 0) > 0 && (
				<p className="history-notice">
					{snapshot!.omittedItems} earlier messages omitted from this view.
					Latest messages are shown.
				</p>
			)}
			{snapshot?.truncated && snapshot.omittedItems === undefined && (
				<p className="history-notice">
					Some content is shortened or unavailable in this view.
				</p>
			)}
			<section className="conversation" aria-label="Conversation">
				{conversation}
			</section>
		</>
	);
}
