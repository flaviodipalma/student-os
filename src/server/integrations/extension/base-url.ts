import "server-only"

import { parseLmsBaseUrl } from "../lms/base-url"

// The school's LMS address in an import from the browser extension: any public
// HTTPS address (schools run Canvas and Blackboard on their own domains too).
//
// Unlike OAuth, where the server sends the app's client secret and the student's
// token to this address (so only allowlisted hosts are accepted), an extension
// import never makes the server contact it: the address only decides which links
// are kept ("Open in Canvas / Blackboard" must be on this same host). Still no IP
// addresses, ports, credentials or local names.
export function parseExtensionLmsBaseUrl(input: string, lmsName: string): string {
  return parseLmsBaseUrl(input, "any-https", {
    invalid: `The extension sent a ${lmsName} address Student OS can't use. Open your school's ${lmsName} (https://…) and try again.`,
    notAllowed: () => "",
  })
}
