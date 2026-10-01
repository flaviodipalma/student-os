import type { Metadata } from "next"
import { ContactEmail, LegalLink, LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page"

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for using Quadernio, in plain words.",
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These terms are the agreement between you and Quadernio when you use the Quadernio app, website and browser
          extension. By creating an account or using Quadernio, you agree to them. Please also read our{" "}
          <LegalLink href="/privacy">Privacy Policy</LegalLink>, which explains how we handle your data.
        </p>
      }
    >
      <LegalSection id="service" title="What Quadernio is">
        <p>
          Quadernio is a planner for students. It brings your courses, deadlines, classes and commitments together and
          suggests when to study. Quadernio is free to use right now. If we ever introduce paid features, we&apos;ll
          tell you clearly before you&apos;re charged anything.
        </p>
        <p>
          Quadernio is a new service and is still changing. We may add, change or remove features, and we may pause
          or stop the service. If we plan to shut it down, we&apos;ll give you notice and a way to get a copy of your
          data first.
        </p>
      </LegalSection>

      <LegalSection id="account" title="Your account">
        <LegalList>
          <li>
            You must be at least 13 years old, and old enough where you live to agree to these terms without a
            parent&apos;s permission.
          </li>
          <li>Give accurate information when you sign up, and keep your password to yourself.</li>
          <li>You&apos;re responsible for what happens in your account. Tell us right away if you think someone else got in.</li>
          <li>One person per account. Don&apos;t share your account or create accounts for others without their permission.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="content" title="Your content">
        <p>
          Everything you add to Quadernio, like your courses, tasks, notes and uploaded syllabi, stays yours. You give
          us permission to store and process it only as needed to run Quadernio for you, as described in the Privacy
          Policy. Only upload material you have the right to use.
        </p>
      </LegalSection>

      <LegalSection id="accuracy" title="Check your deadlines">
        <p>
          Quadernio gets information from you, from your syllabus, from Canvas, Blackboard or Brightspace D2L, from your calendars, from
          your school&apos;s website and from AI. Any of these can be incomplete, out of date or wrong: a syllabus can
          be misread, a sync can be late, and an AI can make mistakes.
        </p>
        <p>
          <strong>
            Your school, your instructors and your official course sites are always the source of truth.
          </strong>{" "}
          Quadernio is a helper, not a replacement for them. You&apos;re responsible for your deadlines, exams and
          grades, and we&apos;re not responsible for a missed deadline or a lower grade.
        </p>
      </LegalSection>

      <LegalSection id="use" title="Using Quadernio fairly">
        <p>Please don&apos;t:</p>
        <LegalList>
          <li>use Quadernio to break the law or your school&apos;s rules, including its academic integrity rules;</li>
          <li>try to access other people&apos;s accounts or data, or get around Quadernio&apos;s security or limits;</li>
          <li>overload, attack, scrape or reverse engineer the service, or use bots to access it;</li>
          <li>upload anything harmful, like malware, or content you don&apos;t have the right to share.</li>
        </LegalList>
        <p>
          The Assistant is for planning your studies. Use it responsibly, and follow your school&apos;s rules about AI.
        </p>
      </LegalSection>

      <LegalSection id="others" title="Other services">
        <p>
          Quadernio works with Canvas, Blackboard, Brightspace D2L, Google Calendar and Outlook, but it isn&apos;t made,
          endorsed or supported by Instructure, Anthology, D2L, Google, Microsoft or your school. Their own terms apply when you use
          their services. Connecting them is optional, and you can disconnect them at any time.
        </p>
      </LegalSection>

      <LegalSection id="ours" title="Quadernio's own content">
        <p>
          The Quadernio name, logo, design and software belong to Quadernio. You may use the app for your own studies,
          but you may not copy, resell or redistribute it.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="Ending your account">
        <p>
          You can stop using Quadernio at any time and delete your account in Settings &gt; Profile &gt; Delete account. We
          may suspend or close an account that breaks these terms or puts other students or the service at risk. Where
          we can, we&apos;ll warn you first and explain why.
        </p>
      </LegalSection>

      <LegalSection id="warranty" title="No guarantees">
        <p>
          We work hard to make Quadernio reliable, but it&apos;s provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo;. We don&apos;t promise it will always be available, free of errors, or that its plans,
          reminders or AI answers will be correct or complete.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limits on our responsibility">
        <p>
          To the extent the law allows, Quadernio isn&apos;t liable for indirect or consequential losses, such as missed
          deadlines, lost grades or lost data. Our total responsibility to you for any claim about the service is limited
          to the amount you paid us in the 12 months before the claim, which is zero while Quadernio is free. Some places
          don&apos;t allow these limits, so they may not all apply to you, and nothing here takes away rights you have
          under consumer protection laws.
        </p>
      </LegalSection>

      <LegalSection id="law" title="Governing law">
        <p>
          These terms are governed by the laws of the State of Connecticut, United States, without regard to its conflict
          of laws rules. Any dispute that can&apos;t be settled informally will be handled by the state or federal courts
          located in Connecticut. If you live in a country whose consumer protection laws give you the right to bring a
          claim in your own courts, or under your own laws, this section doesn&apos;t take that right away.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          We may update these terms as Quadernio grows. We&apos;ll change the date at the top, and for important changes
          we&apos;ll tell you in the app or by email before they take effect. If you keep using Quadernio afterwards,
          you accept the new terms. If you don&apos;t agree, you can stop using it and delete your account.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about these terms? Email <ContactEmail />.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
