import type { Metadata } from "next"
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow"

export const metadata: Metadata = { title: "Welcome" }

export default function OnboardingPage() {
  return <OnboardingFlow />
}
