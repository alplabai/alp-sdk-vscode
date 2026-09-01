// SPDX-License-Identifier: Apache-2.0
//
// Pulling an ALP-Bxxx diagnostic code back OUT of a `tan validate` issue
// message (#617).
//
// `tan validate`'s issues carry the code INSIDE the message text, not as
// `issues[].code` — that field is a generic wrapper
// ("validate.schema-violation"), the same for every schema violation.
// Measured at tan 0.6.0, a board.yaml carrying both an unknown top-level key
// AND an invalid enum value, run against a resolved SDK:
//
//   issues: [
//     { code: "validate.schema-violation", severity: "error",
//       message: "ALP-B002: unknown key 'totally_unknown_key'\n  see: ..." },
//     { code: "validate.schema-violation", severity: "error",
//       message: "ALP-B003: 'verbose' is not one of [...]\n  hint: ...\n  see: ..." },
//   ]
//
// `tan explain --code <ALP-Bxxx>` is the catalogue verb that answers what one
// of these means, so surfacing it means reading the code back out of prose
// tan wrote for a terminal — classifying on PROSE, which tan is free to
// reword. The regex is therefore deliberately narrow: exactly the documented
// shape (`docs/diagnostics/ALP-Bxxx.md`), "ALP-B" plus exactly three digits,
// word-bounded on both sides. Nothing looser (a variable digit count, a
// lowercase spelling, an unanchored prefix). A miss degrades to "no
// explanation available" — `null` / an empty list — never a thrown error and
// never a guessed code.

const ALP_DIAGNOSTIC_CODE = /\bALP-B\d{3}\b/;

/**
 * Pull the one ALP-Bxxx code out of a single issue message, or `null` when
 * the message names none — a miss, not an error (see the module doc).
 */
export function extractDiagnosticCode(message: string): string | null {
  const match = ALP_DIAGNOSTIC_CODE.exec(message);
  return match ? match[0] : null;
}

/**
 * Every DISTINCT ALP-Bxxx code named across a set of issue messages, in
 * first-seen order. `validate` can fail on more than one thing at once
 * (measured: two, above), and each one is worth its own "Explain <code>"
 * offer rather than only the first surviving — a `Set`-backed dedupe would
 * also work but would not preserve the order the issues themselves came in,
 * which matters here because that is the order the actions render in.
 */
export function extractDiagnosticCodes(messages: string[]): string[] {
  const codes: string[] = [];
  for (const message of messages) {
    const code = extractDiagnosticCode(message);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}
