import { inflateSync } from "node:zlib";

const ESC = String.fromCharCode(27);
const SIXEL_START = `${ESC}Pq`;
const SIXEL_END = `${ESC}\\`;
// pi-tui recognizes this harmless OSC image prefix as an atomic image line.
// iTerm2 ignores it when Sixel mode is explicitly selected; xterm ignores it
// and continues with the following Sixel DCS.
const ATOMIC_IMAGE_MARKER = `${ESC}]1337;File=name=sixel;inline=1:${SIXEL_END}`;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode the RGBA8/RGB8 PNGs produced by Resvg without adding an image dependency. */
function decodePng(png: Buffer): DecodedPng {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("invalid PNG signature");
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("truncated PNG chunk");
    if (type === "IHDR") {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      const bitDepth = png[dataStart + 8];
      colorType = png[dataStart + 9] ?? -1;
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || png[dataStart + 12] !== 0) {
        throw new Error("unsupported PNG format for Sixel");
      }
    } else if (type === "IDAT") {
      idat.push(png.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (width <= 0 || height <= 0 || idat.length === 0) throw new Error("incomplete PNG");
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height * 3);
  let rawOffset = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const row = new Uint8Array(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] ?? 0 : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] ?? 0 : 0;
      const value = row[x] ?? 0;
      row[x] = filter === 0 ? value
        : filter === 1 ? (value + left) & 0xff
          : filter === 2 ? (value + above) & 0xff
            : filter === 3 ? (value + Math.floor((left + above) / 2)) & 0xff
              : filter === 4 ? (value + paeth(left, above, upperLeft)) & 0xff
                : (() => { throw new Error("unsupported PNG filter"); })();
    }
    for (let x = 0; x < width; x += 1) {
      const input = x * bytesPerPixel;
      const output = (y * width + x) * 3;
      pixels[output] = row[input] ?? 0;
      pixels[output + 1] = row[input + 1] ?? 0;
      pixels[output + 2] = row[input + 2] ?? 0;
    }
    previous = row;
  }
  return { width, height, pixels };
}

function resize(decoded: DecodedPng, maxWidth: number, maxHeight: number): DecodedPng {
  const scale = Math.min(1, maxWidth / decoded.width, maxHeight / decoded.height);
  const width = Math.max(1, Math.floor(decoded.width * scale));
  const height = Math.max(1, Math.floor(decoded.height * scale));
  if (width === decoded.width && height === decoded.height) return decoded;
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(decoded.width - 1, Math.floor(x / scale));
      const sourceY = Math.min(decoded.height - 1, Math.floor(y / scale));
      const source = (sourceY * decoded.width + sourceX) * 3;
      const target = (y * width + x) * 3;
      pixels[target] = decoded.pixels[source] ?? 0;
      pixels[target + 1] = decoded.pixels[source + 1] ?? 0;
      pixels[target + 2] = decoded.pixels[source + 2] ?? 0;
    }
  }
  return { width, height, pixels };
}

function colorIndex(r: number, g: number, b: number): number {
  return Math.round(r / 255 * 3) * 16 + Math.round(g / 255 * 3) * 4 + Math.round(b / 255 * 3);
}

function colorForIndex(index: number): Rgb {
  return {
    r: Math.round((index >> 4) / 3 * 100),
    g: Math.round(((index >> 2) & 3) / 3 * 100),
    b: Math.round((index & 3) / 3 * 100),
  };
}

function encodeRun(length: number, character: string): string {
  return length > 3 ? `!${length}${character}` : character.repeat(length);
}

/** Encode a PNG into a 64-color Sixel image. */
export function encodeSixelPng(png: Buffer, maxWidthPx: number, maxHeightPx: number): string {
  const decoded = resize(decodePng(png), Math.max(1, maxWidthPx), Math.max(6, maxHeightPx));
  const colors = new Set<number>();
  const indexed = new Uint8Array(decoded.width * decoded.height);
  for (let i = 0; i < indexed.length; i += 1) {
    const pixel = i * 3;
    const index = colorIndex(decoded.pixels[pixel] ?? 0, decoded.pixels[pixel + 1] ?? 0, decoded.pixels[pixel + 2] ?? 0);
    indexed[i] = index;
    colors.add(index);
  }
  let output = `${ATOMIC_IMAGE_MARKER}${SIXEL_START}"1;1;${decoded.width};${decoded.height}`;
  for (const index of colors) {
    const color = colorForIndex(index);
    output += `#${index};2;${color.r};${color.g};${color.b}`;
  }
  for (let band = 0; band < decoded.height; band += 6) {
    for (const index of colors) {
      let run = "";
      let runLength = 0;
      for (let x = 0; x < decoded.width; x += 1) {
        let bits = 0;
        for (let bit = 0; bit < 6; bit += 1) {
          const y = band + bit;
          if (y < decoded.height && indexed[y * decoded.width + x] === index) bits |= 1 << bit;
        }
        const character = String.fromCharCode(63 + bits);
        if (character === run && runLength > 0) runLength += 1;
        else {
          if (runLength > 0) output += encodeRun(runLength, run);
          run = character;
          runLength = 1;
        }
      }
      if (runLength > 0) output += encodeRun(runLength, run);
      output += "$";
    }
    output += "-";
  }
  return `${output}${SIXEL_END}`;
}

export function detectSixelSupport(env: Record<string, string | undefined> = process.env): boolean {
  const protocol = env.PIANO_IMAGE_PROTOCOL?.trim().toLowerCase();
  if (protocol === "sixel") return true;
  if (protocol === "kitty" || protocol === "iterm2" || protocol === "none") return false;
  if (env.PIANO_SIXEL === "1" || env.PIANO_SIXEL === "true") return true;
  const term = env.TERM?.toLowerCase() ?? "";
  return term.includes("sixel") || env.TERM_PROGRAM?.toLowerCase() === "mintty" || env.TERM_PROGRAM?.toLowerCase() === "mlterm";
}
