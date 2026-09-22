"use client"

import { useAppStore } from "@/lib/app-store"

// Tasks from the shared app store (loaded from the database).
// `today` is the student's "YYYY-MM-DD", decided on the server for this page load.
export function useTasks() {
  const { tasks, today, addTask, updateTask, deleteTask, setStatus } = useAppStore()
  return { tasks, today, addTask, updateTask, deleteTask, setStatus }
}
