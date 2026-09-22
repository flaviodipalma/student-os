"use client"

import { useState } from "react"
import { EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTasks } from "@/lib/task-store"
import { priorities, priorityLabel, statusLabel } from "@/lib/tasks"
import type { Priority, Task, TaskStatus } from "@/lib/types"
import { TaskFormDialog } from "./task-form-dialog"
import { TaskRow } from "./task-row"

// A list of tasks with edit / status / priority / delete actions on each row.
export function TaskList({
  tasks,
  showCourse = true,
  showDescription = true,
  emptyMessage = "No tasks here.",
}: {
  tasks: Task[]
  showCourse?: boolean
  showDescription?: boolean
  emptyMessage?: string
}) {
  const { updateTask, deleteTask, setStatus } = useTasks()
  // The task stays set while its dialog animates closed, so the text doesn't flicker.
  const [editing, setEditing] = useState<Task | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      {tasks.length === 0 && (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      )}
      <ul className="divide-y">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskRow
              task={task}
              showCourse={showCourse}
              showDescription={showDescription}
              actions={
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" />}
                    aria-label={`Actions for ${task.title}`}
                  >
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditing(task)
                        setEditOpen(true)
                      }}
                    >
                      <PencilIcon />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Status</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                          value={task.status}
                          onValueChange={(value) => setStatus(task.id, value as TaskStatus)}
                        >
                          {(Object.keys(statusLabel) as TaskStatus[]).map((status) => (
                            <DropdownMenuRadioItem key={status} value={status} closeOnClick>
                              {statusLabel[status]}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Priority</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                          value={task.priority}
                          onValueChange={(value) => updateTask(task.id, { priority: value as Priority })}
                        >
                          {priorities.map((priority) => (
                            <DropdownMenuRadioItem key={priority} value={priority} closeOnClick>
                              {priorityLabel[priority]}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        setDeleting(task)
                        setDeleteOpen(true)
                      }}
                    >
                      <Trash2Icon />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          </li>
        ))}
      </ul>

      {editing && (
        <TaskFormDialog open={editOpen} onOpenChange={setEditOpen} task={editing} />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.title}&rdquo; will be removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) deleteTask(deleting.id)
                setDeleteOpen(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
