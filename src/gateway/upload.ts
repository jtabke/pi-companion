import { createHash } from "node:crypto";
import sharp from "sharp";
import { limits, type BrowserImage } from "../shared/protocol.js";

// Gateway only. One admitted operation, one libvips processing thread, no disk cache.
sharp.cache(false);
sharp.concurrency(1);
export const imageDecodeMs = 3_000;
export class ImageError extends Error {}

const crcTable = Array.from({ length: 256 }, (_, value) => {
	for (let bit = 0; bit < 8; bit++)
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});
// Reject unsupported containers before any native inspection (notably SVG/HEIC).
// libvips reads only the first JPEG and does not report MPO/concatenated pages.
function container(
	source: Buffer,
	mime: BrowserImage["images"][number]["mime"],
) {
	if (mime === "image/png") {
		if (!source.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
			throw new ImageError("Image format does not match declared MIME");
		let offset = 8,
			ended = false;
		while (offset + 12 <= source.length) {
			const size = source.readUInt32BE(offset),
				name = source.toString("ascii", offset + 4, offset + 8);
			if (offset + 12 + size > source.length) break;
			if (name === "acTL")
				throw new ImageError("Animated images are not supported");
			let crc = 0xffffffff;
			for (let i = offset + 4; i < offset + 8 + size; i++)
				crc = crcTable[(crc ^ source[i]) & 255] ^ (crc >>> 8);
			if ((crc ^ 0xffffffff) >>> 0 !== source.readUInt32BE(offset + 8 + size))
				throw new ImageError("Image is corrupt (PNG checksum)");
			offset += 12 + size;
			if (name === "IEND") {
				ended = size === 0 && offset === source.length;
				break;
			}
		}
		if (!ended) throw new ImageError("Image is malformed or truncated");
	} else if (mime === "image/jpeg") {
		if (source[0] !== 0xff || source[1] !== 0xd8)
			throw new ImageError("Image format does not match declared MIME");
		let offset = 2,
			ended = false;
		while (offset < source.length) {
			if (source[offset++] !== 0xff) break;
			while (source[offset] === 0xff) offset++;
			const marker = source[offset++];
			if (marker === 0xd9) {
				ended = offset === source.length;
				break;
			}
			if (marker === 0xd8 || marker === 0 || marker === undefined) break;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
			if (offset + 2 > source.length) break;
			const size = source.readUInt16BE(offset);
			if (size < 2 || offset + size > source.length) break;
			if (
				marker === 0xe2 &&
				source.toString("ascii", offset + 2, offset + 6) === "MPF\u0000"
			)
				throw new ImageError("Multipage JPEG images are not supported");
			offset += size;
			if (marker === 0xda) {
				// Entropy-coded bytes use FF00 stuffing; skip restart markers, stop at the next real marker.
				while (offset < source.length) {
					if (source[offset] !== 0xff) {
						offset++;
						continue;
					}
					let next = offset + 1;
					while (source[next] === 0xff) next++;
					if (
						source[next] === 0 ||
						(source[next] >= 0xd0 && source[next] <= 0xd7)
					) {
						offset = next + 1;
						continue;
					}
					break;
				}
			}
		}
		if (!ended)
			throw new ImageError(
				"Image is malformed, truncated, or contains multiple JPEGs",
			);
	} else if (
		source.toString("ascii", 0, 4) !== "RIFF" ||
		source.toString("ascii", 8, 12) !== "WEBP"
	) {
		throw new ImageError("Image format does not match declared MIME");
	} else if (
		source.length < 12 ||
		source.readUInt32LE(4) + 8 !== source.length
	) {
		throw new ImageError("Image is malformed or truncated");
	}
}

export async function normalizeImage(
	body: BrowserImage["images"][number],
	departed: () => boolean,
	start = performance.now(),
) {
	const check = () => {
		if (departed())
			throw new ImageError("Image request departed; nothing dispatched");
		if (performance.now() - start >= imageDecodeMs)
			throw new ImageError(
				"Image processing deadline exceeded; nothing dispatched",
			);
	};
	check();
	const source = Buffer.from(body.source, "base64");
	if (
		!source.length ||
		source.length > limits.imageBytes ||
		source.toString("base64") !== body.source
	)
		throw new ImageError(
			"Image source must be canonical base64 and at most 4,000,000 bytes",
		);
	container(source, body.mime);
	const sourceDigest = createHash("sha256").update(source).digest("hex");
	const format =
		body.mime === "image/jpeg"
			? "jpeg"
			: body.mime === "image/png"
				? "png"
				: "webp";
	const decoder = sharp(source, {
		failOn: "warning",
		limitInputPixels: limits.pixels,
		pages: 1,
	});
	try {
		// metadata has no cancellable deadline. Always await settlement before releasing admission.
		const metadata = await decoder.metadata();
		check();
		if (metadata.format !== format)
			throw new ImageError("Image format does not match declared MIME");
		if (
			(metadata.pages ?? 1) !== 1 ||
			metadata.delay ||
			metadata.loop !== undefined
		)
			throw new ImageError("Animated or multipage images are not supported");
		if (
			!metadata.width ||
			!metadata.height ||
			metadata.width * metadata.height > limits.pixels
		)
			throw new ImageError("Image exceeds 20,000,000 pixels");
		// Default re-encoding strips EXIF/XMP/ICC. Auto-orient, never resize to override Pi policy.
		// Native cooperative eval-progress timeout excludes libuv wait; not a hard wall-clock guarantee.
		const { data, info } = await decoder
			.rotate()
			.toFormat(format)
			.timeout({
				seconds: Math.max(
					1,
					Math.ceil((imageDecodeMs - (performance.now() - start)) / 1000),
				),
			})
			.toBuffer({ resolveWithObject: true });
		check();
		if (
			info.width * info.height > limits.pixels ||
			data.length > limits.imageBytes
		)
			throw new ImageError(
				"Normalized image exceeds 4,000,000 bytes or 20,000,000 pixels",
			);
		return { image: data.toString("base64"), sourceDigest };
	} catch (error) {
		if (error instanceof ImageError) throw error;
		throw new ImageError(
			"Image is invalid, too large, or exceeded the processing deadline",
		);
	}
}
