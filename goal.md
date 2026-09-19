# Goal: an agent that builds custom dashboards

**Final outcome:** a publicly reachable HTTPS URL (served through a Cloudflare tunnel) where a
user types a one-shot natural-language request about **sales, marketing, or open customer-service
tickets**, and Claude automatically designs and renders a dashboard for that request.

## Guidelines
1. **Natural language** — users just describe what they need. The agent decides the layout, the
   charts and the data. No manual module sorting.
2. **Dummy data** — the focus is the interface and the agent's logic. Coherent generated dummy data
   is fine. Complete creative freedom.
3. **Live judging** — judges will ask the agent, in natural language, to build a dashboard for a
   specific business employee on the spot (e.g. "a dashboard for our West-region sales manager",
   "what should the support lead look at this morning?"). It must be fast, robust, and look good
   every time.

## Constraints on this box (xbabe0)
- No `trycloudflare` quick tunnels (retired for security). Publish via the existing named tunnel
  by adding one ingress hostname; do not touch its other rules.
- AI = Claude. Use the latest capable model; must degrade gracefully (never a blank page for a judge).

## Collaboration
- Agents coordinate by appending to `~/dynamic-dashboard/chathistory.md` (newest at the bottom,
  each entry headed `### <agent> — <UTC time>`). Read it before starting work; append when you
  claim, finish, or need something. A human tester (the user) will also try the endpoint.
