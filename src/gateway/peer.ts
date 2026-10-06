import { request, type IncomingMessage } from "node:http";
import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { ownerRead, ownerStat } from "../shared/runtime.js";
import {
	QuestionsSchema,
	questionLimits,
	QuestionReceiptSchema,
	type Questions,
	type PrivateQuestionReply,
	type QuestionReceipt,
	RegistrationSchema,
	SnapshotSchema,
	StatusSchema,
	limits,
	type Registration,
	type Snapshot,
	type Status,
	ReceiptSchema,
	type Receipt,
	type TextRequest,
	type ImageRequest,
	type StopRequest,
	type RenameRequest,
} from "../shared/protocol.js";
export function peerResponse(
	runtime: string,
	peer: Registration,
	path: string,
	signal?: AbortSignal,
): Promise<IncomingMessage> {
	ownerStat(runtime, "directory");
	const socketPath = join(runtime, `b-${peer.generation}.sock`);
	ownerStat(socketPath, "socket");
	return new Promise((resolve, reject) => {
		const req = request(
			{
				socketPath,
				path,
				method: "GET",
				headers: { "x-c2-capability": peer.capability },
				agent: false,
				signal,
			},
			resolve,
		);
		req.on("error", reject);
		// Discovery's whole-response deadline must include silent headers/bodies.
		// An earlier idle destroy can surface only as ECONNRESET on an open body.
		if (!signal)
			req.setTimeout(2500, () =>
				req.destroy(
					Object.assign(new Error("Bridge timed out"), { code: "ETIMEDOUT" }),
				),
			);
		req.end();
	});
}
async function readJson(
	runtime: string,
	peer: Registration,
	path: string,
	max: number,
	signal?: AbortSignal,
) {
	const res = await peerResponse(runtime, peer, path, signal);
	if (res.statusCode !== 200) {
		res.destroy();
		throw new Error("Bridge unavailable");
	}
	return readResponseJson(res, max, "Bridge response limit");
}
async function readResponseJson(
	res: IncomingMessage,
	max: number,
	limitError: string,
): Promise<unknown> {
	let total = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of res) {
		total += chunk.length;
		if (total > max) {
			res.destroy();
			throw new Error(limitError);
		}
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}
export async function readSnapshot(
	runtime: string,
	peer: Registration,
): Promise<Snapshot> {
	const data = await readJson(runtime, peer, "/snapshot", limits.snapshotBytes);
	if (
		!Value.Check(SnapshotSchema, data) ||
		data.instance !== peer.instance ||
		data.generation !== peer.generation
	)
		throw new Error("Bridge identity mismatch");
	return data;
}
export async function readStatus(
	runtime: string,
	peer: Registration,
	signal?: AbortSignal,
): Promise<Status> {
	const data = await readJson(
		runtime,
		peer,
		"/status",
		limits.statusBytes,
		signal,
	);
	if (
		!Value.Check(StatusSchema, data) ||
		data.summary.instance !== peer.instance ||
		data.summary.generation !== peer.generation
	)
		throw new Error("Bridge identity mismatch");
	return data;
}
export type Discovery = {
	overLimit: boolean;
	peers: { registration: Registration; status: Status }[];
	failure?: "timeout" | "peer-limit";
};
export const discoveryBudgetMs = 3500;
export async function discover(runtime: string): Promise<Discovery> {
	const deadline = Date.now() + discoveryBudgetMs;
	ownerStat(runtime, "directory");
	const files = readdirSync(runtime).filter((name) =>
		/^b-[a-f0-9]{32}\.json$/.test(name),
	);
	const peers: Discovery["peers"] = [];
	const signal = AbortSignal.timeout(discoveryBudgetMs);
	let timedOut = false;
	// Limit reachable identities, not leftover files from abruptly closed terminals.
	// Batch reachability checks to bound concurrent sockets; no PID or mtime inference.
	for (let offset = 0; offset < files.length; offset += limits.peers) {
		if (signal.aborted || Date.now() >= deadline)
			return { overLimit: false, peers: [], failure: "timeout" };
		await Promise.all(
			files.slice(offset, offset + limits.peers).map(async (name) => {
				try {
					const recordPath = join(runtime, name);
					const recordStat = ownerStat(recordPath, "file");
					const record = ownerRead(recordPath, 1024);
					const data: unknown = JSON.parse(record);
					if (
						!Value.Check(RegistrationSchema, data) ||
						name !== `b-${data.instance}.json`
					)
						return;
					const socketPath = join(runtime, `b-${data.generation}.sock`);
					let socketStat: ReturnType<typeof ownerStat> | undefined;
					try {
						try {
							socketStat = ownerStat(socketPath, "socket");
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code !== "ENOENT")
								throw error;
						}
						const status = await readStatus(runtime, data, signal);
						peers.push({ registration: data, status });
					} catch (error) {
						if (
							(error as NodeJS.ErrnoException).code === "ETIMEDOUT" ||
							signal.aborted
						)
							timedOut = true;
						// Only a missing/refused socket proves this generation is dead.
						// Never prune timeouts, schema/capability failures or replacement inodes.
						if (
							!["ENOENT", "ECONNREFUSED"].includes(
								(error as NodeJS.ErrnoException).code ?? "",
							)
						)
							return;
						if (socketStat) {
							const current = ownerStat(socketPath, "socket");
							if (
								current.ino !== socketStat.ino ||
								current.dev !== socketStat.dev
							)
								return;
							unlinkSync(socketPath);
						}
						const current = ownerStat(recordPath, "file");
						if (
							current.ino === recordStat.ino &&
							current.dev === recordStat.dev &&
							ownerRead(recordPath, 1024) === record
						)
							unlinkSync(recordPath);
					}
				} catch {
					/* Invalid, stale or unreachable registrations are never attached. */
				}
			}),
		);
		if (timedOut || signal.aborted || Date.now() >= deadline)
			return { overLimit: false, peers: [], failure: "timeout" };
		if (peers.length > limits.peers)
			return { overLimit: true, peers: [], failure: "peer-limit" };
	}
	return { overLimit: false, peers };
}

// Only fixed input/Stop POSTs are permitted. A transport failure is uncertain at the gateway.
export function sendRename(
	runtime: string,
	peer: Registration,
	body: RenameRequest,
) {
	return sendInput(runtime, peer, body);
}
export function sendStop(
	runtime: string,
	peer: Registration,
	body: StopRequest,
) {
	return sendInput(runtime, peer, body);
}
export function sendImage(
	runtime: string,
	peer: Registration,
	body: ImageRequest,
) {
	return sendInput(runtime, peer, body);
}
export async function sendText(
	runtime: string,
	peer: Registration,
	body: TextRequest,
): Promise<Receipt> {
	return sendInput(runtime, peer, body);
}
async function sendInput(
	runtime: string,
	peer: Registration,
	body: TextRequest | ImageRequest | StopRequest | RenameRequest,
): Promise<Receipt> {
	ownerStat(runtime, "directory");
	const socketPath = join(runtime, `b-${peer.generation}.sock`);
	ownerStat(socketPath, "socket");
	const res = await new Promise<IncomingMessage>((resolve, reject) => {
		const req = request(
			{
				socketPath,
				path:
					"name" in body
						? "/rename"
						: !("text" in body)
							? "/stop"
							: "images" in body
								? "/image"
								: "/text",
				method: "POST",
				agent: false,
				headers: {
					"x-c2-capability": peer.capability,
					"content-type": "application/json",
				},
			},
			resolve,
		);
		req.on("error", reject);
		req.setTimeout(2500, () => req.destroy(new Error("Bridge timed out")));
		req.end(JSON.stringify(body));
	});
	const receipt = await readResponseJson(res, 1024, "Receipt limit");
	if (
		res.statusCode !== 200 ||
		!Value.Check(ReceiptSchema, receipt) ||
		receipt.requestId !== body.requestId
	)
		throw new Error("Invalid receipt");
	return receipt;
}

export async function readQuestions(
	runtime: string,
	peer: Registration,
): Promise<Questions> {
	const data = await readJson(
		runtime,
		peer,
		"/questions",
		questionLimits.stateBytes,
	);
	if (
		!Value.Check(QuestionsSchema, data) ||
		data.instance !== peer.instance ||
		data.generation !== peer.generation ||
		data.pending.some(
			(p) => Buffer.byteLength(JSON.stringify(p)) > questionLimits.requestBytes,
		) ||
		Buffer.byteLength(JSON.stringify(data.pending)) >
			questionLimits.totalBytes + 16
	)
		throw new Error("Invalid question state");
	return data;
}
export async function sendQuestionReply(
	runtime: string,
	peer: Registration,
	body: PrivateQuestionReply,
	signal: AbortSignal,
): Promise<QuestionReceipt> {
	ownerStat(runtime, "directory");
	const socketPath = join(runtime, `b-${peer.generation}.sock`);
	ownerStat(socketPath, "socket");
	const res = await new Promise<IncomingMessage>((resolve, reject) => {
		const req = request(
			{
				socketPath,
				path: "/question-reply",
				method: "POST",
				agent: false,
				signal,
				headers: {
					"x-c2-capability": peer.capability,
					"content-type": "application/json",
				},
			},
			resolve,
		);
		req.on("error", reject);
		req.setTimeout(2500, () => req.destroy(new Error("Bridge timed out")));
		req.end(JSON.stringify(body));
	});
	const receipt = await readResponseJson(
		res,
		questionLimits.bodyBytes,
		"Question receipt limit",
	);
	if (
		res.statusCode !== 200 ||
		!Value.Check(QuestionReceiptSchema, receipt) ||
		receipt.invocationId !== body.reply.invocationId ||
		receipt.replyId !== body.reply.replyId
	)
		throw new Error("Invalid question receipt");
	return receipt;
}
