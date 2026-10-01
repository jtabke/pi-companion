import { closeSync } from "node:fs";
import { join } from "node:path";
import fsExt from "fs-ext";
import { ownerOpen, ownerStat } from "../shared/runtime.js";
// Never unlink this inode. The CLI holds the descriptor until process exit.
export function acquireGatewayLock(runtime: string) {
	ownerStat(runtime, "directory");
	const fd = ownerOpen(join(runtime, "gateway.lock"), true);
	try {
		fsExt.flockSync(fd, "exnb");
		return fd;
	} catch {
		closeSync(fd);
		throw new Error("A gateway already owns this runtime directory");
	}
}
