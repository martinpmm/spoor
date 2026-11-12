---
name: spoor-workflows
description: Find repetitive work in the user's own browser activity, recorded locally by Spoor, and remember it across sessions. Use when the user asks what they keep doing over and over, what to automate, where their time goes, what they copy and paste between systems, which AI prompts they repeat, or for a weekly review of their work. Requires the spoor MCP server (tools such as get_overview and top_sequences).
---

# Spoor workflows

Spoor records how the user works in their browser and keeps it on their machine. This skill turns that log into a short list of repetitive tasks worth automating, and keeps what it learns in the agent's memory so each run builds on the last one.

## Before you start

1. **Check the tools.** You need the `spoor` MCP tools (`get_overview`, `list_sessions`, `get_session`, `top_sequences`, `site_switches`, `field_values`, `ai_usage`, `search_events`). If they are missing, stop and tell the user to connect Spoor first (see `docs/CLAUDE_SETUP.md` in the Spoor repository).
2. **Read your memory.** Look in the memory you already have (your memory files, `CLAUDE.md`, saved notes or whatever your agent uses) for earlier Spoor findings: workflows found before, ones the user already automated or chose to ignore, the names the user gave them, and the user's role and tools. Use them to:
   - keep the same names for the same workflows,
   - skip what the user said to leave alone,
   - report what is **new**, what **grew** and what **disappeared** since last time (a workflow that disappeared after being automated is a win worth saying).
3. **Pick the range.** Use what the user asked for. Otherwise use the last 7 days, or the time since your last saved review if that is longer.

## Analyze

Work through these in order, calling tools with the chosen `from` and `to`.

1. **Where the time goes.** `get_overview`: active time, top sites and screens, active hours.
2. **Repeated sequences.** `top_sequences` with `length` 3, 4 and 6 and `minCount` 3. Name each one as a workflow in plain language ("Copy invoice data from the ERP into the bank portal"). Merge sequences that are parts of the same workflow. When a sequence is unclear, read one or two example sessions with `list_sessions` and `get_session`.
3. **Hand-copied data.** `site_switches` for pairs of systems the user jumps between, and `field_values` on the busiest screens for fields typed or pasted by hand with the same kind of value.
4. **Repeated AI requests.** `ai_usage`: prompts the user sends again and again are candidates for a saved prompt, a template or their own skill.
5. **Size it.** Estimated weekly time = repetitions per week × average duration. Say how you estimated it.
6. **Classify** each workflow as one of: "automate with an agent", "build an integration", "fix with a template", "save as a prompt or skill" or "leave alone", with a one-sentence reason.

## Report

Lead with the answer, then the evidence:

1. The one workflow you would automate first, and why.
2. A table ranked by estimated weekly time: rank, workflow, systems, repetitions per week, average duration, estimated weekly time, classification, evidence (the steps, screens or fields you relied on).
3. Changes since the last review, if your memory had one.
4. Anything you could not judge because the data is thin (for example fewer than three days recorded), and what would fix it.

## Remember

After reporting, offer to save the findings to your memory. Save them if the user agrees or asked you to keep track. Write one entry for Spoor (update it rather than adding a new one each time) with:

- the date of the review and the range covered,
- each workflow's name, systems, weekly time and classification,
- what the user decided: automate, ignore, already automated,
- anything the user told you about their work that explains the data.

**Never save raw values.** Store workflow names, systems and counts only, never typed values, pasted text, prompt text, names of people, amounts or anything that looks like a credential. The Spoor log stays the source of truth; your memory only keeps the summary.

## Privacy

Tool results become part of this conversation. If the user turned off "Let Claude read typed values" in Spoor's settings, tools return only lengths: work with that and do not ask them to turn it back on. Quote typed values only when they are needed to explain a workflow, and shorten them.
