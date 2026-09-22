"use client"

import { createContext, use, useState } from "react"
import type { Task, TaskInput, TaskStatus } from "@/lib/types"

// The single source of task data for the whole app. Every page (Dashboard,
// Tasks, Courses) reads and updates tasks through useTasks().
//
// For now the tasks live in memory: changes survive moving between pages but
// reset on a full page reload. When the database arrives, these functions will
// call it instead, and the pages using them won't need to change.

type TaskStore = {
  tasks: Task[]
  // "YYYY-MM-DD" for the student's today, decided once on the server.
  today: string
  addTask: (input: TaskInput) => void
  updateTask: (id: string, changes: Partial<TaskInput>) => void
  deleteTask: (id: string) => void
  setStatus: (id: string, status: TaskStatus) => void
}

const TaskStoreContext = createContext<TaskStore | null>(null)

export function TaskStoreProvider({
  initialTasks,
  today,
  children,
}: {
  initialTasks: Task[]
  today: string
  children: React.ReactNode
}) {
  const [tasks, setTasks] = useState(initialTasks)

  const updateTask = (id: string, changes: Partial<TaskInput>) =>
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, ...changes } : task)))

  const store: TaskStore = {
    tasks,
    today,
    addTask: (input) => setTasks((prev) => [...prev, { ...input, id: crypto.randomUUID() }]),
    updateTask,
    deleteTask: (id) => setTasks((prev) => prev.filter((task) => task.id !== id)),
    setStatus: (id, status) => updateTask(id, { status }),
  }

  return <TaskStoreContext value={store}>{children}</TaskStoreContext>
}

export function useTasks(): TaskStore {
  const store = use(TaskStoreContext)
  if (!store) throw new Error("useTasks must be used inside TaskStoreProvider")
  return store
}
