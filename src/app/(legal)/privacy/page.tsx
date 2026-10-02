import type { Metadata } from "next"
import { ContactEmail, LegalLink, LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Quadernio collects, why, who it's shared with, and how to delete it.",
}

// Keep this in line with what the code does (docs/security.md, "Data kept").
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          Quadernio helps students plan their semester: courses, deadlines, classes and study time in one place. This
          policy explains, in plain words, what we collect, why, who helps us run the service, and the choices you have.
          The short version: we only collect what the app needs to work, we never sell your data, and there are no ads
          or trackers.
        </p>
      }
    >
      <LegalSection id="collect" title="What we collect">
        <p>
          <strong>Your account.</strong> Your email address, your first name, your password (stored only as a secure
          hash by our login provider, never readable by us), your school, and your current term and year. If you sign
          in with Google or Microsoft, we receive your name and email address from them. We don&apos;t receive or store
          your Google or Microsoft password.
        </p>
        <p>
          <strong>What you add to Quadernio.</strong> Courses, tasks and deadlines, class times, events, weekly
          commitments (like work or sports), study sessions, reminders and your preferences. Quadernio also learns from
          your own history, for example how long your tasks really take, to plan better for you. That learning stays in
          your account.
        </p>
        <p>
          <strong>Courses and assignments from Canvas, Blackboard or Brightspace D2L.</strong> When you use the Quadernio browser
          extension, it reads your courses, assignments, due dates and submission status from your school&apos;s Canvas,
          Blackboard or Brightspace D2L, in your own browser, and sends only those details to Quadernio. For the courses
          you choose, it also reads their calendar events and their announcements from the last three weeks, so exams,
          quizzes and cancelled classes reach your plan. Your school login never leaves your browser, and our servers never
          contact your school&apos;s system.
        </p>
        <p>
          <strong>Google Calendar and Outlook, if you connect them.</strong> We read your calendar events (title, time,
          location, description and link) so your plan doesn&apos;t overlap with them. Access is read-only: Quadernio never creates,
          changes or deletes anything in your calendar. The access keys the calendar provider gives us are stored
          encrypted and are only used to sync.
        </p>
        <p>
          <strong>Syllabus uploads.</strong> When you import a syllabus PDF, we read its text to find your deadlines,
          then discard the file. We don&apos;t keep the PDF or its text, only its file name and how many items were
          found.
        </p>
        <p>
          <strong>The Assistant.</strong> Your conversation with the Assistant is kept only in your open browser tab,
          not on our servers. It&apos;s gone when you close the tab.
        </p>
        <p>
          <strong>Push reminders, if you turn them on.</strong> Your browser gives us a technical address for your
          device so we can send you reminders. Turning push off removes it.
        </p>
        <p>
          <strong>Feedback you send us.</strong> Your message, its type (bug, idea…) and the page you were on.
        </p>
        <p>
          <strong>Technical logs.</strong> To keep the service running, our servers record errors and basic request
          information (such as which page failed and when). Logs never contain your passwords, calendar events, task
          details, syllabus text or Assistant conversations.
        </p>
      </LegalSection>

      <LegalSection id="use" title="How we use it">
        <LegalList>
          <li>To run Quadernio for you: show your courses and deadlines, build your plan, and send your reminders.</li>
          <li>To keep your account secure and prevent abuse.</li>
          <li>To fix problems and improve the app, using your feedback and error logs.</li>
          <li>To email you about your account (for example to confirm your email address or reset your password).</li>
        </LegalList>
        <p>
          We don&apos;t sell your data, we don&apos;t show ads, and we don&apos;t use your data to build advertising
          profiles. We don&apos;t use your Google or Microsoft data for anything other than showing your calendar in
          Quadernio.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="AI features">
        <p>
          Quadernio uses an AI model from Anthropic to read syllabi, to answer your questions in the Assistant, to read
          your school&apos;s public academic calendar, and to read your courses&apos; new announcements for quizzes, exams,
          deadlines and cancelled classes. Only what each request needs is sent: the syllabus text for an import; for the
          Assistant your recent messages plus the parts of your plan the question is about; and for announcements, each
          new announcement&apos;s text with its course and the day it was posted (each one is read only once).
          Your email address, passwords and access keys are never sent. Under its commercial terms, Anthropic does not
          use this data to train its models.
        </p>
        <p>
          AI can make mistakes. Always check important dates against your syllabus or your course site. The Assistant
          and the announcement reader only suggest changes; nothing changes in your plan until you confirm it.
        </p>
      </LegalSection>

      <LegalSection id="share" title="Who helps us run Quadernio">
        <p>We share data only with the services that run Quadernio for us, and only what each one needs:</p>
        <LegalList>
          <li>
            <strong>Supabase</strong>: our database and login provider, where your account and your data are stored.
          </li>
          <li>
            <strong>Vercel</strong>: hosts the Quadernio website and servers.
          </li>
          <li>
            <strong>Anthropic</strong>: the AI features described above.
          </li>
          <li>
            <strong>Google and Microsoft</strong>: only if you choose to sign in with them or connect their calendars.
          </li>
          <li>
            <strong>Your browser&apos;s push service</strong> (for example from Apple, Google or Mozilla): delivers push
            reminders, if you turn them on.
          </li>
          <li>
            <strong>An email delivery service</strong>: sends account emails such as sign-up confirmations.
          </li>
        </LegalList>
        <p>
          These services may process data in the United States and other countries. We may also share information if
          the law requires it, or to protect the safety of our users. If Quadernio is ever sold or merged, your data
          would move with it under the same promises, and we&apos;d tell you first.
        </p>
      </LegalSection>

      <LegalSection id="google" title="Google user data">
        <p>
          Quadernio&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="font-medium text-primary hover:underline"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We use Google Calendar data only to show your events in Quadernio
          and plan around them. We don&apos;t transfer it to others except as needed to run that feature, use it for
          advertising, or let people read it, unless you ask us to (for example for support) or the law requires it.
          Google Calendar data is never used to train AI models.
        </p>
      </LegalSection>

      <LegalSection id="keep" title="How long we keep it">
        <LegalList>
          <li>Your account and plan: for as long as you have an account.</li>
          <li>Reminders you&apos;ve read or dismissed: deleted after 60 days.</li>
          <li>
            Google Calendar and Outlook events and access keys: deleted as soon as you disconnect that calendar.
          </li>
          <li>Syllabus files: never stored.</li>
          <li>
            Course announcements: we keep only each one&apos;s title and when it was posted, so it isn&apos;t read twice,
            never its text. Suggestions you dismiss are kept so they don&apos;t come back.
          </li>
          <li>
            When you delete your account, your data is deleted right away. Copies in our backups disappear within 30
            days, as the backups are replaced.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="choices" title="Your choices and rights">
        <LegalList>
          <li>You can see and change your data in the app at any time.</li>
          <li>You can disconnect Google Calendar, Outlook, Canvas, Blackboard or Brightspace D2L in Integrations.</li>
          <li>You can turn push reminders off in Settings.</li>
          <li>
            You can delete your account and everything in it at any time in Settings &gt; Profile &gt; Delete account.
          </li>
          <li>
            You can ask us for a copy of your data or to correct it: email <ContactEmail /> from the email address on
            your account. We answer within 30 days.
          </li>
        </LegalList>
        <p>
          Depending on where you live (for example in the European Union, the United Kingdom or California), you may
          have further rights, such as objecting to how we use your data or complaining to your local data protection
          authority. Contact us and we&apos;ll help.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies and storage in your browser">
        <p>
          Quadernio uses only the cookies it needs to work: one to keep you logged in, a short-lived one to connect a
          calendar safely, and one to remember light or dark mode. Your browser also stores a few small preferences for
          the app. There are no advertising or analytics cookies, and no third-party trackers.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          All traffic is encrypted with HTTPS. Each student&apos;s data is kept separate from everyone else&apos;s,
          checked on every request and enforced by the database itself. Calendar access keys are encrypted. No system is
          perfectly secure, but we work hard to protect your data, and we&apos;ll tell you promptly if a breach affects
          you.
        </p>
      </LegalSection>

      <LegalSection id="age" title="Age">
        <p>
          Quadernio is made for students in college and university. You must be at least 13 years old to use it, and
          old enough where you live to agree to this policy without a parent&apos;s permission. If you believe a child
          has given us personal data, contact us and we&apos;ll delete it.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this policy">
        <p>
          If we change this policy, we&apos;ll update the date at the top. If a change affects how we use your data in
          an important way, we&apos;ll tell you in the app or by email before it takes effect.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about your privacy? Email <ContactEmail />. See also our{" "}
          <LegalLink href="/terms">Terms of Service</LegalLink>.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
