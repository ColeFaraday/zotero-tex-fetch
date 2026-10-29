// Decoding of arXiv e-print payloads: gzip, tar, or a bare PDF. Pure apart
// from webGlobal().

import { webGlobal } from "./web-global";

export type SourceFiles = Map<string, Uint8Array>;

export type Eprint =
  | { kind: "pdf" }
  | { kind: "source"; files: SourceFiles };

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const DS = webGlobal<typeof DecompressionStream>("DecompressionStream");
  const stream = new DS("gzip");
  const writer = stream.writable.getWriter();
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});

  const reader = stream.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readString(block: Uint8Array, start: number, length: number) {
  let end = start;
  while (end < start + length && block[end] !== 0) end++;
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(block[i]);
  return s;
}

function readOctal(block: Uint8Array, start: number, length: number) {
  return parseInt(readString(block, start, length).trim() || "0", 8);
}

// Validates the header checksum, which works for v7, ustar and GNU archives
// alike (older arXiv submissions predate the ustar magic).
export function isTar(data: Uint8Array): boolean {
  if (data.length < 512) return false;
  const stored = readOctal(data, 148, 8);
  if (Number.isNaN(stored)) return false;
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += i >= 148 && i < 156 ? 32 : data[i];
  }
  return sum === stored;
}

export function untar(data: Uint8Array): SourceFiles {
  const files: SourceFiles = new Map();
  let offset = 0;
  let longName: string | null = null;

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    let name = readString(header, 0, 100);
    if (readString(header, 257, 5) === "ustar") {
      const prefix = readString(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }

    if (type === "L") {
      longName = readString(body, 0, body.length);
      continue;
    }
    if (type === "x") {
      const TD = webGlobal<typeof TextDecoder>("TextDecoder");
      const path = /\d+ path=([^\n]*)\n/.exec(new TD().decode(body));
      if (path) longName = path[1];
      continue;
    }
    if (longName) {
      name = longName;
      longName = null;
    }
    if (type === "0" || type === "\0" || type === "7") {
      files.set(normalizePath(name), body);
    }
  }
  return files;
}

export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function startsWith(data: Uint8Array, magic: number[]) {
  return magic.every((b, i) => data[i] === b);
}

export async function decodeEprint(data: Uint8Array): Promise<Eprint> {
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46])) return { kind: "pdf" };

  const raw = startsWith(data, [0x1f, 0x8b]) ? await gunzip(data) : data;
  if (startsWith(raw, [0x25, 0x50, 0x44, 0x46])) return { kind: "pdf" };
  if (isTar(raw)) return { kind: "source", files: untar(raw) };
  return { kind: "source", files: new Map([["main.tex", raw]]) };
}

// arXiv names downloads like "arXiv-1706.03762v7.tar.gz".
export function versionFromFilename(filename: string): number | null {
  const m = /v(\d+)(?:\.[A-Za-z]+)*$/.exec(filename);
  return m ? Number(m[1]) : null;
}
