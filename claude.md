# AI Assistant Instructions

Please read the `docs/GUIDE.md` file before starting any work. It is the entry point that explains the project and tells you which additional files in the `docs/` folder to read based on your task.

**CRITICAL INSTRUCTION**: If you figure out anything new, discover new patterns, or make any architectural changes, you MUST add that information back to the relevant file in the `docs/` folder so that future AI assistants have access to it. You should not feel the need to update these files if the change is minor or doesn't make a large impact to the system.

**CRITICAL INSTRUCTION**: Avoid looping analysis. When you have identified a likely cause and a clear fix, make the change immediately. Do not keep re-examining the same evidence or generating alternative hypotheses once you have a reasonable answer. Token usage is expensive — act decisively on the first confident conclusion rather than exhausting alternatives through continued analysis.

**CRITICAL INSTRUCTION — Cost contract**: This project must be kept as close to **$0/month** as possible. Before proposing any feature, dependency, or architectural change, evaluate its steady-state and peak monthly cost on the existing GCP / Cloud Run / Firestore stack. If a change introduces recurring spend, it must either be bounded by an enforced cap (kill switch, daily budget, scoped instance window) or be explicitly funded by future revenue. The full cost contract — including target spend, what's free vs. paid on this stack, the 🟢🟡🟠🔴 classification, and the budget alert thresholds — lives in [`product-backlog/00-cost-constraints.md`](./product-backlog/00-cost-constraints.md). Read it before any work that adds infrastructure, calls a third-party API, or modifies scaling parameters.
