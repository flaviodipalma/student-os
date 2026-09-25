import {
  BookOpenIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MessageSquareTextIcon,
  PlugIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  description: string
  // Also in the bar along the bottom on phones (everything is in the menu).
  inTabBar?: boolean
}

// Single source of truth for the app's main sections.
// The sidebar, mobile menu and page headers all read from this list.
export const navItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboardIcon,
    description: "Your day at a glance.",
  },
  {
    title: "Calendar",
    href: "/calendar",
    icon: CalendarDaysIcon,
    description: "Classes, events and deadlines in one view.",
  },
  {
    title: "Tasks",
    href: "/tasks",
    icon: ListChecksIcon,
    description: "Assignments, readings and to-dos.",
  },
  {
    title: "Courses",
    href: "/courses",
    icon: BookOpenIcon,
    description: "The classes you're taking this term.",
  },
  {
    title: "Planner",
    href: "/planner",
    icon: CalendarClockIcon,
    description: "A daily and weekly plan built from everything above.",
  },
  {
    title: "Assistant",
    href: "/assistant",
    icon: MessageSquareTextIcon,
    description: "Ask about your plan, deadlines and schedule.",
  },
  {
    title: "Integrations",
    href: "/integrations",
    icon: PlugIcon,
    description: "Connect your calendars and your school's learning management system.",
    inTabBar: false,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: SettingsIcon,
    description: "Preferences for your account and planner.",
    inTabBar: false,
  },
]

export function getNavItem(href: string): NavItem {
  const item = navItems.find((item) => item.href === href)
  if (!item) throw new Error(`Unknown nav item: ${href}`)
  return item
}
