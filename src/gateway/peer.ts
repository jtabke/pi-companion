import { request, type IncomingMessage } from "node:http";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { ownerRead, ownerStat } from "../shared/runtime.js";
import {
	QuestionsSchema, questionLimits, QuestionReceiptSchema, type Questions, type PrivateQuestionReply, type QuestionReceipt,
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
} from "../shared/protocol.js";
export function peerResponse(
	runtime: string,
	peer: Registration,
	path: string,
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
			},
			resolve,
		);
		req.on("error", reject);
		req.setTimeout(2500, () => req.destroy(new Error("Bridge timed out")));
		req.end();
	});
}
async function readJson(
	runtime: string,
	peer: Registration,
	path: string,
	max: number,
) {
	const res = await peerResponse(runtime, peer, path);
	if (res.statusCode !== 200) {
		res.destroy();
		throw new Error("Bridge unavailable");
	}
	let total = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of res) {
		total += chunk.length;
		if (total > max) {
			res.destroy();
			throw new Error("Bridge response limit");
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
): Promise<Status> {
	const data = await readJson(runtime, peer, "/status", 8192);
	if (
		!Value.Check(StatusSchema, data) ||
		data.summary.instance !== peer.instance ||
		data.summary.generation !== peer.generation
	)
		throw new Error("Bridge identity mismatch");
	return data;
}
export async function discover(runtime: string) {
	ownerStat(runtime, "directory");
	const files = readdirSync(runtime).filter((name) =>
		/^b-[a-f0-9]{32}\.json$/.test(name),
	);
	if (files.length > limits.peers) return { overLimit: true, peers: [] };
	const peers: { registration: Registration; status: Status }[] = [];
	// Bounded parallel reachability checks; no PID or mtime inference.
	await Promise.all(
		files.map(async (name) => {
			try {
				const data: unknown = JSON.parse(ownerRead(join(runtime, name), 1024));
				if (
					!Value.Check(RegistrationSchema, data) ||
					name !== `b-${data.instance}.json`
				)
					return;
				const status = await readStatus(runtime, data);
				peers.push({ registration: data, status });
			} catch {
				/* Invalid, stale or unreachable registrations are never attached. */
			}
		}),
	);
	return { overLimit: false, peers };
}

// Only fixed input/Stop POSTs are permitted. A transport failure is uncertain at the gateway.
export function sendStop(runtime: string, peer: Registration, body: StopRequest) {
	return sendInput(runtime, peer, body);
}
export function sendImage(runtime: string, peer: Registration, body: ImageRequest) {
	return sendInput(runtime, peer, body);
}
export async function sendText(
	runtime: string,
	peer: Registration,
	body: TextRequest,
): Promise<Receipt> {
	return sendInput(runtime, peer, body);
}
async function sendInput(runtime: string, peer: Registration, body: TextRequest | ImageRequest | StopRequest): Promise<Receipt> {
	ownerStat(runtime, "directory");
	const socketPath = join(runtime, `b-${peer.generation}.sock`);
	ownerStat(socketPath, "socket");
	const res = await new Promise<IncomingMessage>((resolve, reject) => {
		const req = request(
			{
				socketPath,
				path: !("text" in body) ? "/stop" : "image" in body ? "/image" : "/text",
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
	let bytes = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of res) {
		bytes += chunk.length;
		if (bytes > 1024) {
			res.destroy();
			throw new Error("Receipt limit");
		}
		chunks.push(chunk);
	}
	const receipt: unknown = JSON.parse(Buffer.concat(chunks).toString());
	if (
		res.statusCode !== 200 ||
		!Value.Check(ReceiptSchema, receipt) ||
		receipt.requestId !== body.requestId
	)
		throw new Error("Invalid receipt");
	return receipt;
}

export async function readQuestions(runtime: string, peer: Registration): Promise<Questions> {
 const data = await readJson(runtime, peer, '/questions', questionLimits.stateBytes);
 if (!Value.Check(QuestionsSchema, data) || data.instance !== peer.instance || data.generation !== peer.generation || data.pending.some(p => Buffer.byteLength(JSON.stringify(p)) > questionLimits.requestBytes) || Buffer.byteLength(JSON.stringify(data.pending)) > questionLimits.totalBytes + 16) throw new Error('Invalid question state');
 return data;
}
export async function sendQuestionReply(runtime: string, peer: Registration, body: PrivateQuestionReply, signal: AbortSignal): Promise<QuestionReceipt> {
 ownerStat(runtime, 'directory'); const socketPath = join(runtime, `b-${peer.generation}.sock`); ownerStat(socketPath, 'socket');
 const res = await new Promise<IncomingMessage>((resolve, reject) => {
  const req = request({ socketPath, path: '/question-reply', method: 'POST', agent: false, signal, headers: { 'x-c2-capability': peer.capability, 'content-type': 'application/json' } }, resolve);
  req.on('error', reject); req.setTimeout(2500, () => req.destroy(new Error('Bridge timed out'))); req.end(JSON.stringify(body));
 });
 let bytes = 0; const chunks: Buffer[] = [];
 for await (const chunk of res) { bytes += chunk.length; if (bytes > questionLimits.bodyBytes) { res.destroy(); throw new Error('Question receipt limit'); } chunks.push(chunk); }
 const receipt: unknown = JSON.parse(Buffer.concat(chunks).toString());
 if (res.statusCode !== 200 || !Value.Check(QuestionReceiptSchema, receipt) || receipt.invocationId !== body.reply.invocationId || receipt.replyId !== body.reply.replyId) throw new Error('Invalid question receipt');
 return receipt;
}
