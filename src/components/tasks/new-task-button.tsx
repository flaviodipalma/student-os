"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TaskFormDialog } from "./task-form-dialog"

export function NewTaskButton({
  courseId,
  label = "New task",
}: {
  courseId?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        {label}
      </Button>
      <TaskFormDialog open={open} onOpenChange={setOpen} defaultCourseId={courseId} />
    </>
  )
}
