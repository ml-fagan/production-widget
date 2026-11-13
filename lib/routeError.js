/**
 * What a refused write should say on screen.
 *
 * The routes answer with two things: `error`, a short token the boards match
 * on — `held_for_review`, `already_ordered`, `already_drawn` — and sometimes
 * `message`, the sentence a person should read. The tokens exist so code can
 * branch without parsing English; they were never meant to be shown, and
 * "Couldn't update 22512-1. held_for_review" is what happens when they are.
 *
 * So: the sentence if the route sent one, the token if that is all there is,
 * and a fallback for a response that said nothing useful at all.
 */
export function errorText(json, fallback = "That didn't save.") {
  if (!json) return fallback;
  const message = String(json.message || "").trim();
  if (message) return message;
  const error = String(json.error || "").trim();
  if (!error) return fallback;
  // A token that reached here without a sentence beside it. Said plainly
  // rather than shown raw — these are the ones old enough to predate
  // `message`, and they are still refusals somebody has to understand.
  return KNOWN[error] || error;
}

const KNOWN = {
  held_for_review:
    "Held for Mitch's review — it reaches this board once he releases the material.",
  already_ordered: "That line has been ordered, so it can't be changed from here any more.",
  already_drawn: "That line has already been drawn off the register.",
  not_permitted_for_role: "You don't have the right for that.",
  sign_in_required: "Sign in first, so this is recorded against your name.",
};
