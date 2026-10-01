import { limits } from "../shared/protocol.js";
// Container checks and pixel limits precede browser decoding; no native decoder runs inside Pi.
const crcTable = Array.from({ length: 256 }, (_, value) => {
	for (let bit = 0; bit < 8; bit++)
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});
function crc32(bytes: Buffer) {
	let value = 0xffffffff;
	for (const byte of bytes)
		value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
}
export type NativeImage = { type: "image"; data: string; mimeType: string };
export function inspectImage(image: NativeImage) {
	if (image.data.length > Math.ceil(limits.imageBytes / 3) * 4) return;
	// Node's decoder accepts noncanonical input; bounded decode/reencode equality below
	// rejects it without the input-sized stack used by repeated-group regexes.
	const bytes = Buffer.from(image.data, "base64");
	if (
		!bytes.length ||
		bytes.length > limits.imageBytes ||
		bytes.toString("base64") !== image.data
	)
		return;
	let width = 0,
		height = 0;
	const mime = image.mimeType;
	try {
		if (mime === "image/png") {
			if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
				return;
			let offset = 8,
				data = false,
				ended = false;
			while (offset + 12 <= bytes.length) {
				const length = bytes.readUInt32BE(offset),
					type = bytes.toString("ascii", offset + 4, offset + 8);
				if (
					offset + 12 + length > bytes.length ||
					crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
						bytes.readUInt32BE(offset + 8 + length)
				)
					return;
				if (offset === 8) {
					if (
						type !== "IHDR" ||
						length !== 13 ||
						bytes[offset + 18] !== 0 ||
						bytes[offset + 19] !== 0 ||
						bytes[offset + 20] > 1
					)
						return;
					width = bytes.readUInt32BE(offset + 8);
					height = bytes.readUInt32BE(offset + 12);
				}
				if (type === "IDAT") data = true;
				offset += length + 12;
				if (type === "IEND") {
					if (length || offset !== bytes.length) return;
					ended = true;
					break;
				}
			}
			if (!data || !ended) return;
		} else if (mime === "image/jpeg") {
			if (
				bytes.readUInt16BE(0) !== 0xffd8 ||
				bytes.readUInt16BE(bytes.length - 2) !== 0xffd9
			)
				return;
			let offset = 2,
				scan = false;
			while (offset + 4 < bytes.length) {
				if (bytes[offset++] !== 0xff) return;
				while (bytes[offset] === 0xff) offset++;
				const marker = bytes[offset++];
				if (marker === 0xda) {
					scan = true;
					break;
				}
				const size = bytes.readUInt16BE(offset);
				if (size < 2 || offset + size > bytes.length) return;
				if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
					height = bytes.readUInt16BE(offset + 3);
					width = bytes.readUInt16BE(offset + 5);
				}
				offset += size;
			}
			if (!scan) return;
		} else if (mime === "image/webp") {
			if (
				bytes.toString("ascii", 0, 4) !== "RIFF" ||
				bytes.toString("ascii", 8, 12) !== "WEBP" ||
				bytes.readUInt32LE(4) + 8 !== bytes.length
			)
				return;
			const kind = bytes.toString("ascii", 12, 16),
				size = bytes.readUInt32LE(16);
			if (20 + size + (size % 2) > bytes.length) return;
			if (kind === "VP8X" && size === 10) {
				if (bytes[20] & 2) return;
				width = bytes.readUIntLE(24, 3) + 1;
				height = bytes.readUIntLE(27, 3) + 1;
			} else if (
				kind === "VP8 " &&
				size >= 10 &&
				bytes.subarray(23, 26).equals(Buffer.from("9d012a", "hex"))
			) {
				width = bytes.readUInt16LE(26) & 0x3fff;
				height = bytes.readUInt16LE(28) & 0x3fff;
			} else if (kind === "VP8L" && size >= 5 && bytes[20] === 0x2f) {
				const bits = bytes.readUInt32LE(21);
				width = (bits & 0x3fff) + 1;
				height = ((bits >>> 14) & 0x3fff) + 1;
			} else return;
			let offset = 12,
				bitstream = false;
			while (offset + 8 <= bytes.length) {
				const chunk = bytes.toString("ascii", offset, offset + 4),
					length = bytes.readUInt32LE(offset + 4);
				if (
					offset + 8 + length + (length % 2) > bytes.length ||
					["ANIM", "ANMF"].includes(chunk)
				)
					return;
				if (chunk === "VP8 " || chunk === "VP8L") bitstream = length >= 5;
				offset += 8 + length + (length % 2);
			}
			if (!bitstream || offset !== bytes.length) return;
		} else return;
		if (!width || !height || width * height > limits.pixels) return;
		return {
			bytes,
			mime: mime as "image/png" | "image/jpeg" | "image/webp",
			width,
			height,
		};
	} catch {
		return;
	}
}
