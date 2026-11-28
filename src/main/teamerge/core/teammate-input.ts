/** Checks for values that arrive from teammates over the relay before they reach git, files, or a PTY. */
/* oxlint-disable no-control-regex -- matching control characters is this file's job */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// C0 controls, DEL and C1 controls, plus bidi overrides that can disguise text.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g
const CONTROL_CHARS_EXCEPT_NEWLINE_TAB =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g
// Whole terminal escape sequences (OSC, CSI and two-byte ESC), so no "[31m" residue is left behind.
const ESCAPE_SEQUENCES =
  /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[\u001b\u009b]\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g

export function isTeamergeId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Mirrors `git check-ref-format --branch`, and refuses anything git could read as an option. */
export function isSafeBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    return false
  }
  return !(
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock') ||
    value === '@' ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    value.includes('/.') ||
    value.startsWith('.') ||
    /[\s~^:?*[\\\u0000-\u001f\u007f]/.test(value)
  )
}

/** One line of plain text that can be typed into an agent without sending control keys. */
export function toTypeableLine(value: unknown, maxLength = 4000): string {
  return String(value ?? '')
    .replace(ESCAPE_SEQUENCES, '')
    .replace(/\s+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, maxLength)
}

/** Multi-line text with control and escape characters removed; keeps newlines and tabs. */
export function withoutControlChars(value: unknown, maxLength = 64_000): string {
  return String(value ?? '')
    .replace(ESCAPE_SEQUENCES, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS_EXCEPT_NEWLINE_TAB, '')
    .slice(0, maxLength)
}
