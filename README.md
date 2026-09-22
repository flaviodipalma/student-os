# Student OS

A planner for college students that answers "What should I do today?", built with Next.js, TypeScript and Tailwind.

## Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Syllabus import (AI)

Courses → **Import syllabus** reads a PDF syllabus and turns its course details and deadlines into tasks, after you review and confirm them. It uses Claude on the server.

1. Copy `.env.example` to `.env.local`.
2. Set `ANTHROPIC_API_KEY` to your Claude API key.
3. Restart `npm run dev`.

The key is only read on the server and is never sent to the browser. Without a key, the importer shows "Syllabus import isn't set up yet". For development without a key, `SYLLABUS_AI_PROVIDER=mock` uses a simple pattern matcher instead of AI.

## Checks

```bash
npx tsc --noEmit   # types
npm run lint       # lint
npm test           # unit tests (Vitest)
npm run build      # production build
```
