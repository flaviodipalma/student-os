// Builds small, valid PDFs in memory for tests (no binary fixtures in the repo).
// makeTextPdf gives a real text layer; makeBlankPdf has pages but no text, like a scan.

// Escapes text for a PDF string. Em and en dashes use their WinAnsi codes.
function pdfString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/—/g, "\\227")
    .replace(/–/g, "\\226")
}

function buildPdf(pageContents: string[]): Uint8Array {
  const objects: string[] = []
  const pageCount = pageContents.length
  const firstPage = 3
  const font = firstPage + pageCount * 2

  objects.push("<< /Type /Catalog /Pages 2 0 R >>")
  const kids = pageContents.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ")
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`)
  pageContents.forEach((content, i) => {
    const contentsId = firstPage + i * 2 + 1
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentsId} 0 R >>`
    )
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  })
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")

  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Everything above is ASCII, so one character = one byte.
  return Uint8Array.from(pdf, (char) => char.charCodeAt(0))
}

export function makeTextPdf(lines: string[]): Uint8Array {
  const content = ["BT", "/F1 11 Tf", "14 TL", "50 750 Td", ...lines.map((line) => `(${pdfString(line)}) Tj T*`), "ET"].join(
    "\n"
  )
  return buildPdf([content])
}

export function makeBlankPdf(pages = 2): Uint8Array {
  return buildPdf(Array.from({ length: pages }, () => ""))
}

// A PDF with `pages` pages, each with one line of text (for page-limit tests).
export function makeManyPagesPdf(pages: number): Uint8Array {
  return buildPdf(Array.from({ length: pages }, (_, i) => `BT /F1 11 Tf 50 750 Td (Page ${i + 1} of a very long document) Tj ET`))
}
