import type { Metadata } from "next"
import { SyllabusImporter } from "@/components/syllabus/syllabus-importer"

export const metadata: Metadata = { title: "Import a syllabus" }

export default function ImportSyllabusPage() {
  return <SyllabusImporter />
}
