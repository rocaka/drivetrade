import { createFileRoute } from "@tanstack/react-router";
import { DisciplineApp } from "@/components/discipline/app";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <DisciplineApp />;
}
