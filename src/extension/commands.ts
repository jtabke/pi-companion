import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { commandLimits, type Command } from "../shared/protocol.js";
import { browserNativeCommands } from "./native-commands.js";

/** A fresh, bounded public catalog. Keep Pi's first match, never source paths. */
export function nativeCommands(
	getCommands?: ExtensionAPI["getCommands"],
	builtin = false,
): Command[] | undefined {
	if (!getCommands && !builtin) return;
	try {
		const commands: Command[] = builtin ? [...browserNativeCommands] : [],
			seen = new Set(browserNativeCommands.map((c) => c.name));
		let bytes = Buffer.byteLength(JSON.stringify(commands));
		for (const raw of (getCommands?.() ?? []).slice(
			0,
			commandLimits.count - commands.length,
		)) {
			if (seen.has(raw.name)) continue;
			seen.add(raw.name);
			if (
				typeof raw.name !== "string" ||
				raw.name.length > commandLimits.name ||
				!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(raw.name) ||
				!["extension", "prompt", "skill"].includes(raw.source)
			)
				continue;
			const command: Command = {
				name: raw.name,
				description:
					typeof raw.description === "string"
						? raw.description
								.slice(0, commandLimits.description)
								.replace(/[\u0000-\u001f\u007f]/g, " ")
						: "",
				source: raw.source,
			};
			bytes += Buffer.byteLength(JSON.stringify(command)) + 1;
			if (bytes > commandLimits.bytes) break;
			commands.push(command);
		}
		return commands;
	} catch {
		return;
	} // Absent/failed discovery never authorizes slash input.
}
