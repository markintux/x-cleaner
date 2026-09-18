export interface DecodedYtdAssignment {
  readonly path: string;
  readonly category: string;
  readonly values: readonly unknown[];
}

export class JavaScriptAssignmentError extends Error {
  constructor(readonly code: "MALFORMED_ARCHIVE_WRAPPER" | "UNSAFE_ARCHIVE_JAVASCRIPT") {
    super(code);
    this.name = "JavaScriptAssignmentError";
  }
}

/**
 * Decodes the data-only assignment emitted by the X archive exporter.
 * No JavaScript parser or evaluator is involved: the right-hand side must be
 * one JSON array, optionally followed by exactly one semicolon and whitespace.
 */
export class JavaScriptAssignmentDecoder {
  decode(source: string): readonly unknown[] {
    return this.decodeAssignment(source).values;
  }

  decodeAssignment(source: string): DecodedYtdAssignment {
    if (typeof source !== "string") {
      throw new JavaScriptAssignmentError("MALFORMED_ARCHIVE_WRAPPER");
    }

    const normalized = source.replace(/^\uFEFF/u, "");
    const match = /^\s*window\.YTD\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*/u.exec(
      normalized
    );
    if (match === null) {
      throw new JavaScriptAssignmentError("MALFORMED_ARCHIVE_WRAPPER");
    }

    const assignmentPath = match[1];
    if (assignmentPath === undefined) {
      throw new JavaScriptAssignmentError("MALFORMED_ARCHIVE_WRAPPER");
    }
    const rightHandSide = normalized.slice(match[0].length).trim();
    const json = removeOptionalSemicolon(rightHandSide);
    if (!json.startsWith("[")) {
      throw new JavaScriptAssignmentError("UNSAFE_ARCHIVE_JAVASCRIPT");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json) as unknown;
    } catch {
      throw new JavaScriptAssignmentError("MALFORMED_ARCHIVE_WRAPPER");
    }
    if (!Array.isArray(parsed)) {
      throw new JavaScriptAssignmentError("MALFORMED_ARCHIVE_WRAPPER");
    }

    const category = assignmentPath.split(".")[0];
    if (category === undefined) {
      throw new JavaScriptAssignmentError("MALFORMED_ARCHIVE_WRAPPER");
    }
    return { path: assignmentPath, category, values: parsed };
  }
}

export function decodeJavaScriptAssignment(source: string): readonly unknown[] {
  return new JavaScriptAssignmentDecoder().decode(source);
}

export function decodeYtdAssignment(source: string): DecodedYtdAssignment {
  return new JavaScriptAssignmentDecoder().decodeAssignment(source);
}

function removeOptionalSemicolon(source: string): string {
  if (!source.endsWith(";")) {
    return source;
  }
  const withoutSemicolon = source.slice(0, -1).trimEnd();
  if (withoutSemicolon.endsWith(";")) {
    throw new JavaScriptAssignmentError("UNSAFE_ARCHIVE_JAVASCRIPT");
  }
  return withoutSemicolon;
}
