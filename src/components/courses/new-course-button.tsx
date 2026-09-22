"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CourseFormDialog } from "./course-form-dialog"

export function NewCourseButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="lg" variant={variant} onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        New course
      </Button>
      <CourseFormDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
