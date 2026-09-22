import { redirect } from "next/navigation";

// For now the app opens straight onto the dashboard.
export default function Home() {
  redirect("/dashboard");
}
