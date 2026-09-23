"use client"

import { useState } from "react"
import { WhatNowCard } from "@/components/planner/what-now-card"
import { TaskFormDialog } from "@/components/tasks/task-form-dialog"
import type { Task } from "@/lib/types"

// "What should I do now?" on the Dashboard: the same card (and the same planner
// answer) as the Planner page; "Open task" opens the task right here.
export function DashboardWhatNow() {
  const [openTask, setOpenTask] = useState<Task | null>(null)
  return (
    <>
      <WhatNowCard onOpenTask={setOpenTask} />
      {openTask && <TaskFormDialog key={openTask.id} open onOpenChange={(open) => !open && setOpenTask(null)} task={openTask} />}
    </>
  )
}
