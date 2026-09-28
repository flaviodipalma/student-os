// Course codes in one format everywhere: subject letters + course number, nothing
// in between ("PS283", "CSC215", "BIO101").
//
// shortCourseCode, for codes from Canvas or Blackboard, which often pack the
// section and term in too:
//   "PS28301_26/FA"    -> "PS283"     (course 283, section 01, fall 2026)
//   "CSC 215-02 FA26"  -> "CSC215"
//   "BIO-101-02_FA26"  -> "BIO101"
//   "2026FA-MAT141-03" -> "MAT141"
//   "BIO101L"          -> "BIO101L"   (a lab keeps its letter)
// tidyCourseCode, for any saved code: "CSC 215" / "csc-215" -> "CSC215".
//
// A code without a clear subject + number (e.g. "Quinnipiac Orientation") stays as
// it is. Pure: used by the server and by the browser extension's course list.

// Subject letters, an optional space or dash, the number (with the section when
// there are 5-6 digits), and an optional letter right after it (e.g. a lab's "L").
const PATTERN = /(?:^|[^A-Za-z])([A-Za-z]{2,5})([ -]?)(\d{3,6})([A-Za-z](?![A-Za-z]))?/g

// "FA26", "FALL 2026", "SP2027": a term, not a course.
const TERM_WORD = /^(FA|FALL|SP|SPR|SPRING|SU|SUM|SUMMER|WI|WIN|WINTER|SM)$/i

export function shortCourseCode(code: string): string {
  const trimmed = code.trim()
  for (const match of trimmed.matchAll(PATTERN)) {
    const [, subject, , digits, letter = ""] = match
    if (TERM_WORD.test(subject) && /^(20)?\d{2}$/.test(digits.slice(0, 4))) continue
    // 3-4 digits: the course number. 5-6: the number followed by a 2-digit section.
    const number = digits.length <= 4 ? digits : digits.slice(0, digits.length - 2)
    return `${subject.toUpperCase()}${number}${digits.length <= 4 ? letter.toUpperCase() : ""}`
  }
  return trimmed
}

// Just the spacing and case of a code that is exactly subject + number: "CSC 215",
// "csc-215" -> "CSC215". Anything else (a section, a term, words) is left as typed.
const PLAIN_CODE = /^([A-Za-z]{2,5})[\s-]*(\d{3,4})([A-Za-z]?)$/

export function tidyCourseCode(code: string): string {
  const trimmed = code.trim()
  const match = PLAIN_CODE.exec(trimmed)
  return match ? `${match[1]}${match[2]}${match[3]}`.toUpperCase() : trimmed
}

// Canvas often ends a course's name with its full code in brackets:
// "Intro to Forensic Psyc (PS28301_26/FA)" -> "Intro to Forensic Psyc". Only a
// bracket holding a code (no spaces, with a number) is dropped: "Calculus (Honors)"
// keeps its bracket.
const CODE_IN_BRACKETS = /\s*[([]\s*[A-Za-z0-9_/.:-]*\d[A-Za-z0-9_/.:-]*\s*[)\]]\s*$/

export function courseNameWithoutCode(name: string): string {
  const trimmed = name.trim()
  const cleaned = trimmed.replace(CODE_IN_BRACKETS, "").trim()
  return cleaned || trimmed
}
