import { redirect } from "next/navigation";

export default function Home() {
  // In a real app, check auth status and redirect accordingly
  // For now, redirect to signup
  redirect("/signup");
}
