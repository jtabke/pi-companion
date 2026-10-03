import { describe, it, expect, vi } from "vitest";
import sharp, { type Sharp } from "sharp";
import { createHash } from "node:crypto";
import { normalizeImage, imageDecodeMs } from "../src/gateway/upload.js";
import { limits } from "../src/shared/protocol.js";
import { png } from "./fixture.js";
const body = (
	bytes: Buffer,
	mime: "image/png" | "image/jpeg" | "image/webp" = "image/png",
) => ({ source: bytes.toString("base64"), mime });
const solid = (width = 10, height = 20) =>
	sharp({ create: { width, height, channels: 3, background: "red" } });
describe("gateway image normalization", () => {
	it("fully decodes PNG/JPEG/WebP, orients and strips private metadata without resizing", async () => {
		for (const format of ["png", "jpeg", "webp"] as const) {
			const bytes = await solid()
				.withMetadata({ orientation: 6 })
				.withExif({ IFD0: { Artist: "private-owner" } })
				.withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">private</x:xmpmeta>')
				.toFormat(format)
				.toBuffer();
			const result = await normalizeImage(
				body(bytes, `image/${format}`),
				() => false,
			);
			expect(result.sourceDigest).toBe(
				createHash("sha256").update(bytes).digest("hex"),
			);
			const meta = await sharp(Buffer.from(result.image, "base64")).metadata();
			expect([meta.format, meta.width, meta.height]).toEqual([format, 20, 10]);
			for (const key of ["exif", "xmp", "icc", "iptc", "orientation"] as const)
				expect(meta[key]).toBeUndefined();
		}
		expect(sharp.cache().files.max).toBe(0);
		expect(sharp.concurrency()).toBe(1);
	});
	it("rejects mismatches, unsupported, malformed/truncated/corrupt and noncanonical source", async () => {
		const jpeg = await solid().jpeg().toBuffer(),
			webp = await solid().webp().toBuffer();
		for (const input of [
			body(png, "image/jpeg"),
			body(jpeg, "image/png"),
			body(Buffer.from("<svg/>")),
			body(Buffer.from("GIF89a")),
			body(Buffer.from("heic")),
			body(png.subarray(0, -1)),
			body(jpeg.subarray(0, -3), "image/jpeg"),
			body(Buffer.concat([jpeg, jpeg]), "image/jpeg"),
			body(webp.subarray(0, -1), "image/webp"),
			body(Buffer.from("not-image")),
			{ ...body(png), source: body(png).source + "\n" },
		]) {
			await expect(normalizeImage(input, () => false)).rejects.toThrow();
		}
		const corrupt = Buffer.from(png);
		corrupt[45] ^= 0xff;
		await expect(normalizeImage(body(corrupt), () => false)).rejects.toThrow();
	});
	it("rejects animated WebP, APNG and multipage containers", async () => {
		const animation = await sharp(
			Buffer.concat([Buffer.alloc(2 * 2 * 3, 0), Buffer.alloc(2 * 2 * 3, 255)]),
			{ raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } },
		)
			.webp({ loop: 0, delay: [100, 100] })
			.toBuffer();
		expect((await sharp(animation).metadata()).pages).toBe(2);
		await expect(
			normalizeImage(body(animation, "image/webp"), () => false),
		).rejects.toThrow(/Animated/);
		const actl = Buffer.alloc(20);
		actl.writeUInt32BE(8);
		actl.write("acTL", 4);
		actl.writeUInt32BE(2, 8);
		await expect(
			normalizeImage(
				body(Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)])),
				() => false,
			),
		).rejects.toThrow(/Animated/);
		const jpeg = await solid().jpeg({ progressive: true }).toBuffer();
		await expect(
			normalizeImage(body(jpeg, "image/jpeg"), () => false),
		).resolves.toHaveProperty("image");
		const mpf = Buffer.from([0xff, 0xe2, 0, 6, 0x4d, 0x50, 0x46, 0]);
		await expect(
			normalizeImage(
				body(
					Buffer.concat([jpeg.subarray(0, 2), mpf, jpeg.subarray(2)]),
					"image/jpeg",
				),
				() => false,
			),
		).rejects.toThrow(/Multipage/);
		const tiff = await solid().tiff().toBuffer();
		await expect(normalizeImage(body(tiff), () => false)).rejects.toThrow(
			/format/,
		);
	});
	it("enforces source/input pixel/output bounds, including exact source cap and pixel edge", async () => {
		await expect(
			normalizeImage(body(Buffer.alloc(limits.imageBytes + 1)), () => false),
		).rejects.toThrow(/4,000,000/);
		const edge = await solid(5000, 4000).png().toBuffer();
		const output = await normalizeImage(body(edge), () => false);
		expect(
			(await sharp(Buffer.from(output.image, "base64")).metadata()).width,
		).toBe(5000);
		const tooMany = await solid(5001, 4000).png().toBuffer();
		await expect(normalizeImage(body(tooMany), () => false)).rejects.toThrow();
		// Valid JPEG padded with a bounded comment reaches the exact source byte limit.
		const original = await solid().jpeg().toBuffer();
		const comments: Buffer[] = [];
		let remaining = limits.imageBytes - original.length;
		while (remaining > 0) {
			const length = Math.min(remaining, 65537);
			const c = Buffer.alloc(length);
			c[0] = 0xff;
			c[1] = 0xfe;
			c.writeUInt16BE(length - 2, 2);
			comments.push(c);
			remaining -= length;
		}
		await expect(
			normalizeImage(
				body(
					Buffer.concat([
						original.subarray(0, 2),
						...comments,
						original.subarray(2),
					]),
					"image/jpeg",
				),
				() => false,
			),
		).resolves.toHaveProperty("image");
		// Stub only the settled output to deterministically reach the otherwise format-dependent output byte boundary.
		const originalOutput = sharp.prototype.toBuffer;
		const stub = vi.spyOn(sharp.prototype, "toBuffer").mockImplementationOnce(
			async () =>
				({
					data: Buffer.alloc(limits.imageBytes + 1),
					info: { width: 1, height: 1 },
				}) as never,
		);
		try {
			await expect(normalizeImage(body(png), () => false)).rejects.toThrow(
				/Normalized/,
			);
			stub.mockImplementationOnce(
				async () =>
					({ data: png, info: { width: 5001, height: 4000 } }) as never,
			);
			await expect(normalizeImage(body(png), () => false)).rejects.toThrow(
				/Normalized/,
			);
			stub.mockImplementationOnce(
				async () =>
					({
						data: Buffer.alloc(limits.imageBytes),
						info: { width: 5000, height: 4000 },
					}) as never,
			);
			await expect(
				normalizeImage(body(png), () => false),
			).resolves.toHaveProperty("image");
		} finally {
			stub.mockRestore();
		}
		expect(sharp.prototype.toBuffer).toBe(originalOutput);
	});
	it("uses the original batch deadline for later images rather than resetting it", async () => {
		const start = performance.now() - imageDecodeMs;
		await expect(normalizeImage(body(png), () => false, start)).rejects.toThrow(
			/deadline/,
		);
	});

	it("holds awaited metadata/output until actual settlement and discards late/departed results", async () => {
		const timeout = vi.spyOn(sharp.prototype, "timeout");
		for (const phase of ["metadata", "toBuffer"] as const) {
			let unblock!: () => void, started!: () => void;
			const waiting = new Promise<void>((r) => {
				started = r;
			});
			const release = new Promise<void>((r) => {
				unblock = r;
			});
			const original = sharp.prototype[phase];
			const stub = vi
				.spyOn(sharp.prototype, phase)
				.mockImplementationOnce(function (this: Sharp, ...args: unknown[]) {
					started();
					return release.then(() => (original as Function).apply(this, args));
				} as never);
			let departed = false,
				settled = false;
			const pending = normalizeImage(body(png), () => departed).finally(() => {
				settled = true;
			});
			await waiting;
			departed = true;
			await Promise.resolve();
			expect(settled).toBe(false);
			unblock();
			await expect(pending).rejects.toThrow(/departed/);
			stub.mockRestore();
		}
		expect(timeout).toHaveBeenCalledWith({ seconds: 3 });
		timeout.mockRestore();
		const now = performance.now.bind(performance),
			clock = vi.spyOn(performance, "now");
		let calls = 0;
		clock.mockImplementation(() => now() + (calls++ ? imageDecodeMs : 0));
		try {
			await expect(normalizeImage(body(png), () => false)).rejects.toThrow(
				/deadline/,
			);
		} finally {
			clock.mockRestore();
		}
	});
});
