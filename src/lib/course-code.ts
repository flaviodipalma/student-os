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

// LMS course names often repeat the code (with its section and term) around the
// real title. Only the title is kept:
//   "Intro to Forensic Psyc (PS28301_26/FA)"   -> "Intro to Forensic Psyc"   (Canvas)
//   "CS 305 01 - Advanced Computing"           -> "Advanced Computing"       (Brightspace)
//   "CS/SE 450 50 - Cyber Security"            -> "Cyber Security"
//   "CSC215-01-FA26: Data Structures"          -> "Data Structures"          (Blackboard)
//   "2026FA-MAT141-03 Calculus I"              -> "Calculus I"
//   "Data Structures - CSC215-01 - Fall 2026"  -> "Data Structures"
//   "Calculus I FA26", "Biology (Fall 2026)"   -> "Calculus I", "Biology"
//   "Object-Oriented Design - 2026 Spring"     -> "Object-Oriented Design"
//   "Intro Discrete Math (CSC 205)"            -> "Intro Discrete Math"
// A bracket is dropped only when it holds a code (no spaces, with a number):
// "Calculus (Honors)" keeps it. A leading part is dropped only when it's all
// capitals and numbers, contains a course code (subject + number), and a real title
// follows: "US History", "COVID-19 Biology" and "CS 305" alone stay as they are.
const CODE_IN_BRACKETS = /\s*[([]\s*(?:[A-Za-z0-9_/.:-]*\d[A-Za-z0-9_/.:-]*|[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?(?:[ -][A-Z0-9]{1,4})?)\s*[)\]]\s*$/
const HAS_COURSE_CODE = /[A-Za-z]{2,5}[ _-]?\d{3,4}/
const SEPARATOR = /^[-–—:|·]+$/

function withoutLeadingCode(name: string): string {
  const words = name.split(/\s+/)
  let cut = 0
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (SEPARATOR.test(word)) {
      cut = i + 1
      break
    }
    // A title word (has a small letter), or something that isn't code-like.
    if (/[a-z]/.test(word) || !/^[A-Z0-9/&_.,:-]+$/.test(word)) break
    cut = i + 1
    if (/[:]$/.test(word)) break
  }
  const prefix = words.slice(0, cut).filter((word) => !SEPARATOR.test(word)).join(" ")
  const title = words.slice(cut).join(" ").trim()
  // Only when the prefix is a code and what's left reads like a title.
  if (!prefix || !HAS_COURSE_CODE.test(prefix) || !/[A-Za-z]{2}/.test(title)) return name
  return title
}

// A semester at the end, in any of the usual spellings: "FA26", "26SP", "2026SP",
// "Fall 2026", "2026 Spring", "(Spring 2027)", "- Fall 2026".
const SEASON = "(?:fall|spring|summer|winter|fa|sp|su|wi)"
const TERM_AT_END = new RegExp(
  `\\s*(?:[-–—:|·]\\s*)?[([]?\\s*(?<![A-Za-z0-9])(?:${SEASON}\\s*(?:20)?\\d{2}|(?:20)?\\d{2}\\s*${SEASON})\\s*[)\\]]?\\s*$`,
  "i"
)

// A code after a separator at the end: "Data Structures - CSC215-01".
function withoutTrailingCode(name: string): string {
  const words = name.split(/\s+/)
  let start = words.length
  while (start > 0 && !/[a-z]/.test(words[start - 1]) && /^[A-Z0-9/&_.,-]+$/.test(words[start - 1]) && !SEPARATOR.test(words[start - 1])) start--
  if (start === words.length || start === 0 || !SEPARATOR.test(words[start - 1])) return name
  const code = words.slice(start).join(" ")
  const title = words.slice(0, start - 1).join(" ").trim()
  return HAS_COURSE_CODE.test(code) && /[A-Za-z]{2}/.test(title) ? title : name
}

export function courseNameWithoutCode(name: string): string {
  const trimmed = name.trim()
  let cleaned = trimmed.replace(CODE_IN_BRACKETS, "").trim()
  cleaned = withoutLeadingCode(cleaned).trim()
  const withoutTerm = cleaned.replace(TERM_AT_END, "").trim()
  if (/[A-Za-z]{2}/.test(withoutTerm)) cleaned = withoutTerm
  cleaned = withoutTrailingCode(cleaned.replace(CODE_IN_BRACKETS, "").trim()).trim()
  return cleaned || trimmed
}

// An LMS term's name as students say it: "26SP", "SP26", "2026SP", "2026 Spring",
// "FA2026" -> "Spring 2026", "Fall 2026". Anything else ("Fall 2026", "Default Term",
// "Academic Year 2026-27") stays as it is.
const SEASONS: Record<string, string> = {
  fa: "Fall", fall: "Fall",
  sp: "Spring", spr: "Spring", spring: "Spring",
  su: "Summer", sum: "Summer", summer: "Summer",
  wi: "Winter", win: "Winter", winter: "Winter",
}
const SEASON_WORD = "(fa|fall|sp|spr|spring|su|sum|summer|wi|win|winter)"
const YEAR_FIRST = new RegExp(`^((?:20)?\\d{2})[\\s_-]*${SEASON_WORD}$`, "i")
const SEASON_FIRST = new RegExp(`^${SEASON_WORD}[\\s_-]*((?:20)?\\d{2})$`, "i")

export function friendlyTermName(name: string): string {
  const trimmed = name.trim()
  const yearFirst = YEAR_FIRST.exec(trimmed)
  const seasonFirst = SEASON_FIRST.exec(trimmed)
  const [year, season] = yearFirst ? [yearFirst[1], yearFirst[2]] : seasonFirst ? [seasonFirst[2], seasonFirst[1]] : [null, null]
  if (!year || !season) return trimmed
  return `${SEASONS[season.toLowerCase()]} ${year.length === 2 ? `20${year}` : year}`
}
