// src/utils/htmlSafe.js — shared HTML/JSON escaping (#285)
//
// Serialize a value to JSON that is safe to embed inside an HTML <script> element.
// JSON.stringify alone is NOT safe in markup: a value containing "</script>" — or the
// raw line separators U+2028 / U+2029, which are valid in JSON but terminate a JS
// string literal — can break out of the script context and inject markup or script.
//
// We escape the handful of characters that are legal in JSON but dangerous in an
// HTML/JS context to their \uXXXX form. The output stays valid JSON (JSON.parse
// decodes the escapes back to the original characters) but is inert in markup, so it
// can be dropped into a `<script type="application/json">` block or an inline script
// via EJS `<%- %>`.
//
// Replaces the hand-rolled `JSON.stringify(x).replace(/</g, ...)` guards that were
// copy-pasted across the bracket views and only escaped `<`.

// A single backslash, used when assembling the escape sequences below.
const BS = '\\';

// Valid in JSON, unsafe inside <script>: < > & and the U+2028 / U+2029 line
// separators. Built via char codes so no raw separator ever appears in this source.
const UNSAFE_IN_SCRIPT = new RegExp(
  '[<>&' + String.fromCharCode(0x2028, 0x2029) + ']',
  'g',
);

/**
 * Serialize `value` to script-safe JSON.
 *
 * @param {unknown} value - any JSON-serializable value
 * @returns {string} JSON with markup-active characters escaped to \uXXXX
 */
export function safeJsonForScript(value) {
  const json = JSON.stringify(value);
  // JSON.stringify returns undefined for undefined/function/symbol inputs — emit
  // valid JS so a template never interpolates a bare `undefined`.
  if (json === undefined) return 'null';
  return json.replace(
    UNSAFE_IN_SCRIPT,
    (ch) => BS + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

export default safeJsonForScript;
