import {
	constants,
	closeSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, basename } from "node:path";
export function ownerStat(path: string, kind: "directory" | "file" | "socket") {
	const stat = lstatSync(path);
	if (
		stat.uid !== process.getuid!() ||
		(stat.mode & 0o777) !== (kind === "directory" ? 0o700 : 0o600) ||
		!(kind === "directory"
			? stat.isDirectory()
			: kind === "socket"
				? stat.isSocket()
				: stat.isFile())
	)
		throw new Error("Unsafe local resource");
	return stat;
}
export function runtimeDirectory(
	value = process.env.C2_RUNTIME ?? `/tmp/pi-c2-${process.getuid!()}`,
) {
	if (!isAbsolute(value)) throw new Error("Runtime directory must be absolute");
	// Canonicalize the parent (/tmp is a platform symlink on Darwin), never the owned leaf.
	const path = join(realpathSync(dirname(value)), basename(value));
	if (Buffer.byteLength(join(path, "b-" + "a".repeat(32) + ".sock")) > 100)
		throw new Error("Runtime socket path too long");
	try {
		mkdirSync(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	ownerStat(path, "directory");
	return path;
}
export function ownerOpen(path: string, create = false) {
	const fd = openSync(
		path,
		constants.O_NOFOLLOW | constants.O_RDWR | (create ? constants.O_CREAT : 0),
		0o600,
	);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.uid !== process.getuid!() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1
		)
			throw new Error("Unsafe local file");
		return fd;
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}
export function ownerRead(path: string, max: number) {
	const fd = ownerOpen(path);
	try {
		if (fstatSync(fd).size > max) throw new Error("Local file exceeds limit");
		return readFileSync(fd, "utf8");
	} finally {
		closeSync(fd);
	}
}
