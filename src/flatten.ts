// Flattens a multi-file LaTeX project into one document by inlining
// \input, \include, \subfile, \import and the .bbl bibliography. Pure apart
// from webGlobal().

import { SourceFiles, normalizePath } from "./archive";
import { webGlobal } from "./web-global";

export interface FlattenResult {
  text: string;
  mainFile: string;
  inlined: string[];
  missing: string[];
}

const MAX_DEPTH = 30;

const COMMAND_RE = new RegExp(
  [
    String.raw`\\(input|include|subfile)\s*\{([^}]*)\}`,
    String.raw`\\input\s+([^\s{}%\\]+)`,
    String.raw`\\(import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)\*?\s*\{([^}]*)\}\s*\{([^}]*)\}`,
    String.raw`\\bibliography\s*\{[^}]*\}`,
  ].join("|"),
  "g",
);

export function decodeText(bytes: Uint8Array): string {
  const TD = webGlobal<typeof TextDecoder>("TextDecoder");
  try {
    return new TD("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TD("windows-1252").decode(bytes);
  }
}

function dirname(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function join(dir: string, path: string) {
  return normalizePath(dir ? `${dir}/${path}` : path);
}

// Splits a line at its first unescaped %, so commented-out commands are
// left alone.
function splitComment(line: string): [string, string] {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "%") continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 0) return [line.slice(0, i), line.slice(i)];
  }
  return [line, ""];
}

function stripComments(text: string) {
  return text
    .split("\n")
    .map((line) => splitComment(line)[0])
    .join("\n");
}

export function findMainFile(
  files: SourceFiles,
  getText: (path: string) => string,
): string | null {
  const readmeJson = files.get("00README.json");
  if (readmeJson) {
    try {
      const readme = JSON.parse(decodeText(readmeJson));
      const top = readme.sources?.find((s: any) => s.usage === "toplevel");
      if (top?.filename && files.has(normalizePath(top.filename))) {
        return normalizePath(top.filename);
      }
    } catch {
      // Fall through to the heuristics below.
    }
  }

  for (const name of ["00README.XXX", "00README"]) {
    const readme = files.get(name);
    if (!readme) continue;
    const m = /^(\S+)\s+toplevelfile\b/m.exec(decodeText(readme));
    if (m && files.has(normalizePath(m[1]))) return normalizePath(m[1]);
  }

  const texFiles = [...files.keys()].filter((p) => /\.(tex|ltx|latex)$/i.test(p));
  const candidates = texFiles.filter((p) => {
    const code = stripComments(getText(p));
    return (
      /\\document(class|style)\b/.test(code) &&
      /\\begin\s*\{document\}/.test(code)
    );
  });

  if (candidates.length === 0) {
    if (texFiles.length === 1) return texFiles[0];
    return null;
  }
  if (candidates.length === 1) return candidates[0];

  const preferred = candidates.find((p) =>
    /^(main|ms|paper|article|manuscript)\.tex$/i.test(p.split("/").pop()!),
  );
  if (preferred) return preferred;
  return candidates.sort((a, b) => files.get(b)!.length - files.get(a)!.length)[0];
}

export function flattenSource(
  files: SourceFiles,
  options: { label: string },
): FlattenResult {
  const textCache = new Map<string, string>();
  const getText = (path: string) => {
    let text = textCache.get(path);
    if (text === undefined) {
      text = decodeText(files.get(path)!).replace(/\r\n?/g, "\n");
      textCache.set(path, text);
    }
    return text;
  };

  const mainFile = findMainFile(files, getText);
  if (!mainFile) throw new Error("No main .tex file found in the source");

  const mainBase = mainFile.replace(/\.[^./]+$/, "");
  const bblFiles = [...files.keys()].filter((p) => p.endsWith(".bbl"));
  const bblFile = files.has(`${mainBase}.bbl`)
    ? `${mainBase}.bbl`
    : bblFiles.length === 1
      ? bblFiles[0]
      : null;

  const inlined: string[] = [];
  const missing: string[] = [];

  const resolve = (name: string, dirs: string[]) => {
    const cleaned = name.trim().replace(/^"(.*)"$/, "$1");
    for (const dir of dirs) {
      for (const candidate of [cleaned, `${cleaned}.tex`]) {
        const path = join(dir, candidate);
        if (files.has(path)) return path;
      }
    }
    return null;
  };

  const wrap = (path: string, content: string) =>
    `\n% >>> tex-fetch: begin ${path}\n${content.replace(/\n$/, "")}\n% <<< tex-fetch: end ${path}\n`;

  const expand = (
    path: string,
    importDir: string,
    stack: string[],
  ): string => {
    const lines = getText(path).split("\n");
    return lines
      .map((line) => {
        const [code, comment] = splitComment(line);
        const replaced = code.replace(
          COMMAND_RE,
          (whole, cmd, arg, bareArg, importCmd, importPath, importFile) => {
            if (whole.startsWith("\\bibliography")) {
              if (!bblFile || stack.includes(bblFile)) return whole;
              inlined.push(bblFile);
              return wrap(bblFile, getText(bblFile));
            }

            let target: string | null;
            let nextImportDir = importDir;
            let requested: string;
            if (importCmd) {
              const relative = importCmd.startsWith("sub");
              nextImportDir = join(relative ? dirname(path) : "", importPath);
              requested = join(nextImportDir, importFile);
              target = resolve(importFile, [nextImportDir]);
            } else {
              requested = (arg ?? bareArg).trim();
              target = resolve(requested, [importDir, dirname(path), ""]);
            }

            if (!target) {
              missing.push(requested);
              return whole;
            }
            if (stack.includes(target) || stack.length >= MAX_DEPTH) {
              return whole;
            }
            inlined.push(target);
            return wrap(target, expand(target, nextImportDir, [...stack, target]));
          },
        );
        return replaced + comment;
      })
      .join("\n");
  };

  const body = expand(mainFile, "", [mainFile]);

  const header = [
    `% tex-fetch: flattened LaTeX source of ${options.label}`,
    `% Main file: ${mainFile}. Inlined files are wrapped in`,
    `% "% >>> tex-fetch: begin <file>" / "% <<< tex-fetch: end <file>" markers.`,
  ];
  if (missing.length) {
    header.push(
      `% Referenced but not in the source: ${[...new Set(missing)].join(", ")}`,
    );
  }

  return {
    text: `${header.join("\n")}\n\n${body}`,
    mainFile,
    inlined,
    missing: [...new Set(missing)],
  };
}
