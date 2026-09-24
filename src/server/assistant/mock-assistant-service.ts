import "server-only"

import type { AssistantAIRequest, StudentAssistantAIService } from "./ai-service"

// A stand-in for local testing without an AI provider (ASSISTANT_AI_PROVIDER=mock).
// Not AI: it matches a few set questions, calls the same tools Claude would, and
// words the result plainly. Answers still come from the student's real data.

type Json = Record<string, unknown>
type Brief = { title: string; due: string; dueTime: string | null; remainingMinutes: number | null }

const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`)
const due = (t: Brief) => `${t.due}${t.dueTime ? ` at ${t.dueTime}` : ""}`

type Scenario = {
  feasibility: string
  goals: { task: string; target: string; needed: string; planned: string; fits: boolean }[]
  days: { day: string; sessions: { task: string; start: string; end: string }[] }[]
  totals: { plannedStudy: string; workDueInThisPeriod: string; realisticStudyTime: string }
}

// A few words of a scenario: the first days with study, and each goal.
function scenarioText(s: Scenario): string {
  const days = s.days.slice(0, 2).map((d) => `${d.day}: ${d.sessions.map((x) => `${x.task} ${x.start}–${x.end}`).join(", ")}`)
  const goals = s.goals.map((g) => `${g.task}: ${g.planned} planned of ${g.needed} needed by ${g.target}${g.fits ? "" : " (doesn't fully fit)"}`)
  return [...goals, ...days].join(". ")
}

// Dates from the turn context ("today (Thursday) = ...; tomorrow (Friday) = ...; Saturday = ...").
function dateFor(context: string, name: string): string | undefined {
  const entries = /Dates: (.*)\./.exec(context)?.[1].split("; ") ?? []
  for (const entry of entries) {
    const [label, date] = entry.split(" = ")
    if (label.toLowerCase().split(/[ ()]+/).includes(name)) return date
  }
  return undefined
}

export class MockAssistantService implements StudentAssistantAIService {
  async respond({ messages, context, callTool }: AssistantAIRequest): Promise<string> {
    const question = messages.at(-1)?.content.toLowerCase() ?? ""
    const call = async (name: string, input: Json = {}) => JSON.parse((await callTool(name, input)).content) as Json
    const today = /Now: (\d{4}-\d{2}-\d{2})/.exec(context)?.[1] ?? ""
    const focusTaskId = /taskId (\S+),/.exec(context)?.[1]
    const proposal = (result: Json) =>
      result.status === "needs_confirmation" ? `${result.summary} Confirm below.` : String(result.problem ?? "I couldn't plan that.")

    // Personalization (Prompt 32).
    const prefer = /i (?:actually )?prefer studying (?:in the |at )?(morning|afternoon|evening|night)/.exec(question)
    if (prefer) {
      return proposal(await call("correctPersonalization", { preferredPeriods: [prefer[1]] }))
    }
    if (/why did you (?:give|pick|choose) me this/.test(question)) {
      const answer = await call("getWhatShouldIDoNow")
      const task = answer.task as Brief | undefined
      if (!task) return `Right now: ${answer.answer}.`
      const why = (answer.why as string[]).join("; ")
      return `${task.title}: ${why}.${answer.learnedEstimate ? ` ${answer.learnedEstimate}` : ""}`
    }
    const hoursToday = /only want to study (one|two|three|\d+) hours? today/.exec(question)
    if (hoursToday) {
      const hours = { one: 1, two: 2, three: 3 }[hoursToday[1] as "one"] ?? Number(hoursToday[1])
      const result = await call("simulatePlanChange", { intent: { maxStudyMinutes: [{ date: today, minutes: hours * 60 }] }, days: 3 })
      if (result.status !== "simulated") return String(result.problem ?? "I couldn't plan that.")
      const c = result.comparedWithCurrentPlan as { tasksThatMove: { task: string; today: string }[]; todayStudy: string; workMovedOffToday: string; tomorrowStudy: string }
      if (c.workMovedOffToday === "0m") {
        return `Today's plan (${c.todayStudy.split(" → ")[0]}) is already within ${hours}h, so nothing would change. This is only a what-if; nothing was saved.`
      }
      const moves = c.tasksThatMove.map((t) => `${t.task} (${t.today})`).join(", ")
      return `With at most ${hours}h today, ${c.workMovedOffToday} moves off today${moves ? `: ${moves}` : ""}. Tomorrow: ${c.tomorrowStudy}. This is only a what-if; nothing was saved.`
    }

    // Adaptive planning: what was learned (see getLearnedPatterns).
    if (/longer (study )?sessions|learned|study best|my patterns?/.test(question)) {
      const learned = await call("getLearnedPatterns")
      if (!learned.enabled) return String(learned.note)
      const estimates = learned.learnedEstimates as { title: string; explanation: string; confidence: string }[]
      const insights = learned.insights as { text: string }[]
      const first = estimates[0]
      if (first) return `${first.title}: ${first.explanation}${first.confidence === "low" ? " (Still learning your pattern.)" : ""}`
      return insights[0]?.text ?? String(learned.note ?? "I haven't learned any patterns yet.")
    }

    // Planning conversations (see planning-tools.ts).
    if (/take (today|the day) off|skip today/.test(question)) {
      return proposal(await call("applyConfirmedPlanChange", { change: "skip-day", date: today }))
    }
    if (/put (it|that|this) on my calendar|accept (the|this) plan/.test(question)) {
      return proposal(await call("applyConfirmedPlanChange", { change: "accept-day", date: today }))
    }
    if (/can't study tonight|cannot study tonight/.test(question)) {
      const result = await call("simulatePlanChange", { intent: { unavailable: [{ date: today, from: "17:00" }] }, days: 3 })
      const s = result.scenario as Scenario
      return `No problem, nothing needs to change: the Planner moves that work to your next free time. ${scenarioText(s) || "Nothing else is planned."}. (This is a possible plan; nothing was saved.)`
    }
    const whatIfMove = /what if i move (.+?) to tomorrow/.exec(question)
    if (whatIfMove) {
      const task = /^(this|that|it|this assignment|that assignment)$/.test(whatIfMove[1]) ? focusTaskId : whatIfMove[1]
      if (!task) return "Which assignment do you mean?"
      const result = await call("simulatePlanChange", { intent: { whatIf: [{ task, dueDate: dateFor(context, "tomorrow") }] } })
      if (result.status !== "simulated") return String(result.problem ?? "Which one do you mean?")
      const compared = result.comparedWithCurrentPlan as { feasibility: string; totalStudy: string }
      return `If it were due tomorrow: ${scenarioText(result.scenario as Scenario)}. Plan: ${compared.feasibility}. This is only a what-if; nothing was saved.`
    }
    const finishBefore = /finish (?:my )?(.+?) (?:before|by) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.exec(question)
    if (finishBefore) {
      const day = dateFor(context, finishBefore[2])
      const date = day && day > today ? new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10) : day
      const result = await call("simulatePlanChange", { intent: { finishBy: [{ task: finishBefore[1], date }] } })
      if (result.status !== "simulated") return String(result.problem ?? "Which one do you mean?")
      const s = result.scenario as Scenario
      return `${s.feasibility === "feasible" ? "That works." : "That's tight."} ${scenarioText(s)}. (A possible plan; nothing was saved.)`
    }
    if (/exam .*(behind|haven't started)/.test(question)) {
      const numbers = await call("getPlanningContext", { until: dateFor(context, "friday") })
      const result = await call("simulatePlanChange", { intent: { mode: "exam-focus" } })
      return `Before Friday you have about ${numbers.workLeft} of work and about ${numbers.realisticStudyTime} of realistic study time. With exam focus: ${scenarioText(result.scenario as Scenario)}.`
    }
    if (/every afternoon|prepare/.test(question)) {
      const numbers = await call("getPlanningContext", {})
      const days = numbers.perDay as { day: string; realisticStudyMinutes: number; busyWith: string[] }[]
      return `This week you have about ${numbers.workLeft} of work and about ${numbers.realisticStudyTime} of realistic study time around your commitments${
        days[0]?.busyWith.length ? ` (today: ${days[0].busyWith.join(", ")})` : ""
      }. ${numbers.enoughTime ? "It fits." : "It doesn't all fit."}`
    }

    if (/right now|should i (do|work)|work on/.test(question)) {
      const answer = await call("getWhatShouldIDoNow")
      const task = answer.task as Brief | undefined
      if (task) {
        const until = answer.freeUntil as { event: string; at: string } | string | undefined
        const free =
          typeof answer.availableMinutes === "number"
            ? `You have ${minutes(answer.availableMinutes)} free${typeof until === "object" ? ` before ${until.event} (${until.at})` : ""}. `
            : ""
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
