import { redirect } from "next/navigation";

/**
 * The projects board moved, and became the timeline.
 *
 * It was a tile per project with a chain of five circles on it, and the
 * project managers' real board — the one with the sheet, the scope lines and
 * the approvals — lives in the handover app. What this end of the business
 * wanted was never another board to work from; it was the answer to "what
 * happened to this job, and when".
 *
 * A redirect rather than a deletion because people have this bookmarked, and
 * a 404 teaches them the app is broken rather than that the page has a new
 * name.
 */
export default function ProjectsMoved() {
  redirect("/timeline");
}
