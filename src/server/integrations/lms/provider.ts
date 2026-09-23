import "server-only"

import type { LmsAssignment, LmsCourse, LmsCredentials } from "@/lib/lms/types"
import type { LmsProviderId } from "@/lib/types"
import { AppError } from "../../errors"

// The contract every LMS adapter implements. The rest of Student OS only ever
// talks to this interface (through the connection and sync services), never to
// a Canvas or Blackboard API directly.
//
// Adapters are thin: they speak the provider's API and return NORMALIZED data
// (src/lib/lms/types.ts). Matching, conflict handling and saving live in the
// sync service, once, for every provider.
//
// Connecting uses OAuth 2.0 only. Student OS never asks for, sees or stores an
// LMS password.

// Tokens as returned by the provider's OAuth token endpoint.
export type LmsTokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  // The student's id in the LMS, if the provider reports it.
  externalUserId: string | null
}

export interface LmsProvider {
  readonly id: LmsProviderId
  readonly name: string
  // False until the adapter is implemented; Settings then shows "coming soon".
  readonly available: boolean
  // True when this server has the provider's OAuth app credentials (env vars).
  isConfigured(): boolean

  // ---- Connecting (OAuth 2.0 authorization code flow) ----
  // Where to send the student to approve access. `state` is a random, single-use
  // value created and checked by the server (CSRF protection for the callback).
  getAuthorizationUrl(request: { baseUrl: string; redirectUri: string; state: string }): string
  // The OAuth callback: trade the one-time code for tokens.
  exchangeCode(request: { baseUrl: string; redirectUri: string; code: string }): Promise<LmsTokenSet>
  refreshTokens(credentials: LmsCredentials): Promise<LmsTokenSet>
  // Tell the LMS to forget the tokens (on disconnect), where the provider supports it.
  revokeTokens(credentials: LmsCredentials): Promise<void>

  // ---- Reading (normalized) ----
  getCourses(credentials: LmsCredentials): Promise<LmsCourse[]>
  getCourseDetails(credentials: LmsCredentials, courseExternalId: string): Promise<LmsCourse>
  getAssignments(credentials: LmsCredentials, courseExternalId: string): Promise<LmsAssignment[]>
}

// Thrown by adapters that aren't built yet. Safe to show to the student.
export class LmsNotAvailableError extends AppError {
  constructor(providerName: string) {
    super("validation", `${providerName} integration isn't available yet.`)
    this.name = "LmsNotAvailableError"
  }
}

// Base for adapters that aren't implemented yet: every call fails clearly, and
// nothing ever reaches the network.
export abstract class UnavailableLmsProvider implements LmsProvider {
  abstract readonly id: LmsProviderId
  abstract readonly name: string
  readonly available = false
  abstract isConfigured(): boolean

  protected notAvailable(): never {
    throw new LmsNotAvailableError(this.name)
  }
  getAuthorizationUrl(): string {
    return this.notAvailable()
  }
  async exchangeCode(): Promise<LmsTokenSet> {
    return this.notAvailable()
  }
  async refreshTokens(): Promise<LmsTokenSet> {
    return this.notAvailable()
  }
  async revokeTokens(): Promise<void> {
    return this.notAvailable()
  }
  async getCourses(): Promise<LmsCourse[]> {
    return this.notAvailable()
  }
  async getCourseDetails(): Promise<LmsCourse> {
    return this.notAvailable()
  }
  async getAssignments(): Promise<LmsAssignment[]> {
    return this.notAvailable()
  }
}
