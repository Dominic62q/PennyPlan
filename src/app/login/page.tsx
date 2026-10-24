import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in" };

// A green welcome screen with Penny front and centre, then a plain form page.
// Both steps live in LoginForm so the choice between sign in and create
// account carries straight through.
export default function LoginPage() {
  return (
    <main>
      <LoginForm />
    </main>
  );
}
