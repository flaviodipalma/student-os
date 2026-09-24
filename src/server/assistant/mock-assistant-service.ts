import "server-only"

import type { AssistantAIRequest, StudentAssistantAIService } from "./ai-service"

// A stand-in for local testing without an AI provider (ASSISTANT_AI_PROVIDER=mock).
// Not AI: it matches a few set questions, calls the same tools Claude would, and
// words the result plainly. Answers still come from the student's real data.

type Json = Record<string, unknown>
type Brief = { title: string; due: string; dueTime: string | null; remainingMinutes: number | null }

const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`)
const due = (t: Brief) => `${t.due}${t.dueTime ? ` at ${t.dueTime}` : ""}`

export class MockAssistantService implements StudentAssistantAIService {
  async respond({ messages, callTool }: AssistantAIRequest): Promise<string> {
    const question = messages.at(-1)?.content.toLowerCase() ?? ""
    const call = async (name: string, input: Json = {}) => JSON.parse((await callTool(name, input)).content) as Json

    if (/right now|should i (do|work)|work on/.test(question)) {
      const answer = await call("getWhatShouldIDoNow")
      const task = answer.task as Brief | undefined
      if (task) {
        const free = typeof answer.availableMinutes === "number" ? `You have ${minutes(answer.availableMinutes)} available. ` : ""
        return `${free}I'd work on ${task.title}: it's due ${due(task)}${
          typeof answer.remainingMinutes === "number" ? ` and about ${minutes(answer.remainingMinutes)} is left` : ""
        }.`
      }
      const next = answer.nextOpportunity as { task: string; day: string; start: string } | null
      return `Right now: ${answer.answer}.${next ? ` Next: ${next.task}, ${next.day.toLowerCase()} at ${next.start}.` : ""}`
    }
    if (/due|deadline/.test(question)) {
      const result = await call("getUpcomingDeadlines", { days: 7 })
      const tasks = result.tasks as Brief[]
      if (tasks.length === 0) return "Nothing is due in the next 7 days."
      return `You have ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} due in the next 7 days. The earliest is ${tasks[0].title}, due ${due(tasks[0])}.`
    }
    if (/busy|workload|behind/.test(question)) {
      const result = await call("getWorkloadSummary", { days: 7 })
      return `This week: ${result.dueCount} tasks due, about ${minutes(result.workLeftMinutes as number)} of work left.`
    }
    if (/day look|today|plan/.test(question)) {
      const plan = await call("getTodaysPlan")
      const sessions = plan.studySessions as { task: string; start: string; end: string }[]
      const schedule = plan.schedule as { title: string; start: string; end: string }[]
      const parts = [...schedule.map((i) => `${i.title} ${i.start}–${i.end}`), ...sessions.map((s) => `study ${s.task} ${s.start}–${s.end}`)]
      return parts.length ? `Today: ${parts.join(", ")}.` : "Nothing is planned for today."
    }
    const finished = /(?:finished|done with|completed) (?:my |the )?(.+?)[.!]?$/.exec(question)
    if (finished) {
      const result = await call("completeTask", { task: finished[1] })
      if (result.status === "needs_confirmation") return `${result.summary} Confirm below.`
      if (result.status === "ambiguous") return "Which one do you mean?"
      return String(result.problem ?? "I don't have that task in Student OS.")
    }
    return "I'm running in test mode, so I can only answer a few set questions: what to work on now, what's due, how busy your week is and today's plan."
  }
}
