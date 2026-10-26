# System Design Companion feature roadmap

Updated 2026-10-26. Proposed release order, not delivery dates or evidence of customer demand. Targets below are pilot decision gates, not measured results.

## User and outcome

An interview candidate who wants structured practice and evidence of improvement, or an interviewer who wants a reviewable session.

## Current baseline

The product already has collaborative boards, an AI interviewer, high-level agent edits, checkpoints/versions, templates and MCP Apps. Adding another generic chat or diagram tool would duplicate the existing baseline.

Planning evidence: [README](README.md) and [MCP surface](src/worker/mcp.ts) at `a22f4805b704`. This focused product pass does not claim a complete new code audit or live-provider validation.

## Prioritized releases

| Order | Feature                             | User value and scope                                                                                                           | Release acceptance                                                                                                                                        |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Now   | A complete practice-session outcome | Turn the existing interview into a session with a stated goal, a chosen timebox and a final recap tied to diagram checkpoints. | A candidate finishes with strengths, unanswered questions and one concrete next exercise; feedback links to observed decisions.                           |
| Next  | Practice a specific weakness        | Offer short follow-up drills based on a user-selected gap such as estimates, failure modes or trade-off explanation.           | The drill reuses relevant context, records the candidate’s answer and compares it with the earlier attempt without pretending a score is hiring evidence. |
| Next  | A shareable interview packet        | Export the problem, final diagram, selected checkpoints and user-approved notes for review.                                    | The user previews included material; private notes and credentials are excluded, and access is explicit.                                                  |
| Later | A personal practice history         | Show attempts and recurring topics across sessions, with user-correctable feedback.                                            | A candidate can identify progress and choose the next session from actual saved work.                                                                     |

## Measure value before expanding

Baseline five practice sessions: completion rate, time to actionable feedback, candidate-rated usefulness and a second session within a week. Proposed gate: four of five candidates can name a specific improvement from their recap.

Collect the baseline before building the first slice. Use voluntary pilot feedback and minimal aggregate events; do not log private content or credentials to measure adoption. If the first workflow is not used again, revisit the problem before adding the later features. Revenue impact is unvalidated.

## Next shippable slice

Add the session recap and next-exercise handoff around the existing interviewer, versions and rubric capabilities.

## Dependencies and deliberate limits

No hiring-quality or validated skill-score claims. Keep user corrections and uncertainty visible. Coordinate shared canvas work with system-design-chatgpt rather than build competing copies of the same interview feature.

Engineering work belongs in the milestone only when it enables that acceptance criterion. Prefer existing native libraries and test runners. Update this roadmap when a user-visible increment ships, recording the outcome and remaining limits rather than checking off implementation activity alone.
