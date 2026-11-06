---
name: gh-findings
description: Report all open security and quality findings for the repo (code scanning, Dependabot, secret scanning)
allowed-tools: Bash(gh:*), Bash(jq:*)
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/gh-findings
  version: 2026.07.15.1923
---

Report every open security and quality finding for the **whole repository** from GitHub's three alert sources, with summary stats and a full listing. Read-only — this skill never dismisses, resolves, or otherwise mutates alerts.

## Steps

1. Resolve the repository:
   ```sh
   gh repo view --json nameWithOwner -q .nameWithOwner     # {owner}/{repo}
   ```

2. Fetch all open alerts from each source. Each endpoint may return `403`/`404` when the feature is not active or the token lacks access — treat that as "source unavailable" and note it in the report rather than failing the whole skill.

   - **Code scanning** — covers both **security** and **quality** findings (CodeQL security-and-quality suite). Separate the two by whether `rule.security_severity_level` is present (security) or null (quality):
     ```sh
     gh api repos/{owner}/{repo}/code-scanning/alerts --paginate -X GET -f state=open -f per_page=100
     ```
   - **Dependabot** — vulnerable dependency alerts:
     ```sh
     gh api repos/{owner}/{repo}/dependabot/alerts --paginate -X GET -f state=open -f per_page=100
     ```
   - **Secret scanning** — leaked credentials:
     ```sh
     gh api repos/{owner}/{repo}/secret-scanning/alerts --paginate -X GET -f state=open -f per_page=100
     ```

3. Lead with a **summary**:
   - Total open findings, broken down by source (code-scanning security, code-scanning quality, Dependabot, secret scanning).
   - A severity breakdown (`critical` / `high` / `medium` / `low` — plus `warning` / `note` for quality alerts that have no security severity).
   - Note any source that was unavailable and why.

4. Then give the **full listing**, grouped by source and sorted by severity (most severe first). For each finding include:
   - **Code scanning** — `rule.id` / `rule.name`, severity (`rule.security_severity_level` or `rule.severity`), whether it is security or quality, file **path** and **line** (`most_recent_instance.location`), the alert **state**, and the alert **URL** (`html_url`).
   - **Dependabot** — package name and ecosystem, advisory severity, the **summary**/CVE/GHSA id, the manifest **path**, the patched version if any, and the **URL** (`html_url`).
   - **Secret scanning** — secret type (`secret_type_display_name`), state, whether it was validated/`push_protection_bypassed`, and the **URL** (`html_url`).

   For each individual finding, also emit a ready-to-run **fix skill** invocation the user can copy and paste — the alert's `html_url` is the unambiguous identifier:
   ```
   gh-fix <html_url>
   ```
   Terminal links are not clickable into the session, so this is a paste-to-run line, not a hyperlink. For sources where findings are grouped (e.g. Dependabot rolled up by package), give one `gh-fix <html_url>` per package using any one alert URL for that package, and note that `gh-fix` will handle the whole package upgrade.

5. End with a short **call to action**: the count of `critical`/`high` items that warrant immediate attention, a reminder that this skill only reports (fixing is done by `gh-fix <url>`), and that `gh-fix` must be run per finding — it does not auto-fix everything.
