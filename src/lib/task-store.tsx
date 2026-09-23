"use client"

import { useAppStore } from "@/lib/app-store"

// Tasks from the shared app store (loaded from the database).
// `today` is the student's local "YYYY-MM-DD" (follows the shared clock).
export function useTasks() {
  const { tasks, today, addTask, updateTask, deleteTask, setStatus } = useAppStore()
  return { tasks, today, addTask, updateTask, deleteTask, setStatus }
}
