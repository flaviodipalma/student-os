import "server-only"

import { lmsProviderIds, type LmsProviderId } from "@/lib/types"
import { BlackboardProvider } from "./blackboard/blackboard-provider"
import { CanvasProvider } from "./canvas/canvas-provider"
import type { LmsProvider } from "./provider"

// The one place providers are chosen. Adding an LMS = add its id to
// lmsProviderIds (src/lib/types.ts) and the lms_provider enum, write an
// adapter, and register it here.
const providers: Record<LmsProviderId, LmsProvider> = {
  canvas: new CanvasProvider(),
  blackboard: new BlackboardProvider(),
}

export function getLmsProvider(id: LmsProviderId): LmsProvider {
  return providers[id]
}

export function listLmsProviders(): LmsProvider[] {
  return lmsProviderIds.map((id) => providers[id])
}
