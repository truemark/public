---
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/blob/main/.github/copilot-instructions.md
  version: 2026.09.13.0840
---

# Copilot Instructions

This file instructs GitHub Copilot when it performs **code reviews** on pull requests in this repository. It is not a general style guide — it is the set of rules Copilot should check for and flag.

## How to use this file (for the reviewer)

1. **Cite rule codes.** When flagging a violation, reference the rule code (e.g. **TS-001**) in the review comment. Do not paraphrase a rule without citing it. If a comment is not tied to a rule code in this file, it should be clearly marked as a suggestion rather than a required change.
2. **Flag, do not rewrite.** Identify the violation, quote the offending line(s), cite the rule, and propose the minimal fix. Do not rewrite unrelated code.
3. **Stay in scope.** Only comment on lines changed in the diff, or on existing code whose behavior is materially affected by the diff. Do not comment on pre-existing violations in untouched code.
4. **Do not comment on subjective style.** If a behavior is not covered by a rule code in this file (or by an enforced linter / formatter config), do not flag it. In particular, do not comment on naming preferences, comment density, or code "readability" unless a specific rule applies.
5. **Handle ambiguity by asking, not assuming.** If the diff could plausibly comply or violate a rule depending on context not visible in the diff, ask a clarifying question instead of asserting a violation.
6. **Severity.** Treat every rule in this file as required unless the rule text itself uses "should" / "may" rather than "must".

## Domain prefixes

Rule codes are grouped by domain. The following prefixes are reserved:

- `GEN-` — General (repository-wide conventions that apply regardless of language or framework)
- `TS-` — TypeScript / JavaScript (language, tooling, package management)
- `PY-` — Python (language, tooling, style)
- `GQL-` — GraphQL (schema conventions, client types, validation)
- `CDK-` — AWS CDK (infrastructure constructs, stacks, stages)
- `DDB-` — DynamoDB (data access, table and entity modeling)
- `QWIK-` — Qwik (routing, loaders, server boundaries)
- `LIT-` — Lit (web components, reactive properties, attribute mapping)
- `UI-` — User interface (styling, theming)

Additional domains will be added over time. New rules within a domain are appended with the next available number; existing numbers are never reused or renumbered.

---

## General

### File Headers

**GEN-001** — Source files must not contain copyright headers, license disclaimers, author tags, or similar boilerplate comment blocks. Licensing is governed at the repository level (via `LICENSE` files and `package.json`), not per file.

### Terminology

**GEN-002** — Do not use the terms `blacklist` and `whitelist` (in any casing or compound form, e.g. `black_list`, `whiteList`). Use `denylist` and `allowlist` instead. This applies to identifiers, comments, documentation, and user-facing strings.

### HTTP Headers

**GEN-004** — Do not use the `X-` prefix for custom HTTP headers. The `X-` convention was deprecated by [RFC 6648](https://www.rfc-editor.org/rfc/rfc6648) (an IETF Best Current Practice, 2012) because a header that proves useful inevitably outlives its "experimental" prefix, and renaming it later breaks every client. Name new application headers without the prefix — e.g. `cl-signature`, `cl-timestamp` — not `X-Signature` or `X-Webhook-Signature`.

### Distributed Agent Files

**GEN-005** — Agent skills (files under `.claude/skills/`) and this `.github/copilot-instructions.md` file declare their upstream in a `metadata.source` frontmatter field, and downstream repositories re-sync from that source via the `skills-update` skill. This rule applies **only to downstream copies** — a repository whose `metadata.source` points at a **different** repository. In a downstream copy, any change must be made in the **authoritative source** identified by `metadata.source`, never by editing the local copy, because a local edit diverges from the source and is silently overwritten on the next sync; make the fix in the source repository and re-sync instead of patching the copy in place. **Do not flag edits in the authoritative source itself.** When `metadata.source` points at the repository being reviewed (the file is the original, not a synced copy — e.g. this repo is the source for its own `.github/copilot-instructions.md` and `.claude/skills/`), editing the file directly is the correct and intended way to make the change, including version bumps; GEN-005 does not apply.

### Skill Frontmatter

**GEN-006** — Every agent skill (a `SKILL.md` under `.claude/skills/<name>/`) must begin with YAML frontmatter, and that frontmatter must include a `metadata` block declaring `owner`, `source`, and `version`:

- `owner` — the person or team responsible for the skill (e.g. `Erik Jensen (@erikrj)`).
- `source` — the authoritative GitHub URL the skill is published from and synced from (see **GEN-005**), e.g. `https://github.com/erikrj/public/tree/main/.claude/skills/<name>`.
- `version` — a `YYYY.MM.DD.HHMM` timestamp identifying the published revision, bumped whenever the skill changes.

A skill whose `SKILL.md` is missing its frontmatter, the `metadata` block, or any of these three fields must be flagged.

### Paginated CLI Output

**GEN-007** — When a shell snippet counts or aggregates results from `gh api --paginate`, the aggregation must not be performed inside the `--jq` filter. `gh` applies `--jq` to **each page separately** and concatenates the outputs, so a filter ending in `| length` emits one number *per page* (`"1\n0\n0\n1"`), not one total. Any numeric test on that value then fails with a non-integer expression error, and — because the failure looks like "no results" — the bug stays invisible until the data grows past a single page.

Emit one line per matching item and aggregate in the shell instead:

```sh
# wrong — one count per page
n=$(gh api "$endpoint" --paginate --jq '[.[] | select(...)] | length')

# right — one line per match, counted once
n=$(gh api "$endpoint" --paginate --jq '.[] | select(...) | .id' | wc -l | tr -d ' ')
```

The same applies to any `--jq` filter whose result is a scalar summary (`length`, `add`, `max`, `any`) rather than a stream of items. Verify such snippets against a forced multi-page response (`?per_page=1`), not just the single-page case.

### Permission Rules

**GEN-008** — A `deny` rule in `.claude/settings.json` must not be relied on to block a command that can express the same operation with its flags in a different position. Permission rules match the command string from the left: a rule written without a wildcard (`Bash(git push)`) matches that command **exactly**, and a rule ending in `:*` or `*` (`Bash(gh api -X:*)`) matches commands that **begin** with that prefix. Neither form can express "this flag anywhere in the command", so `Bash(gh api -X:*)` does not block `gh api repos/o/r/pulls/1/merge -X PUT`, and `Bash(git push --force:*)` does not block `git push origin HEAD --force`.

Where a capability must actually be withheld, narrow the **allow** list to the exact invocations that are needed rather than denying the ways around it — an unmatched command prompts, which is the safe default. Deny rules remain useful as a guard against the common literal form, but documentation must not describe them as a boundary. When a broad allow rule is genuinely required (e.g. `Bash(gh api:*)`, whose paths vary per call), say plainly what it permits and what actually constrains it.

### Skill Description Accuracy

**GEN-009** — When a `SKILL.md` body changes what the skill does, its frontmatter `description` must be updated in the same change to match. The description is the only text shown in the command list and in the model's skill listing, so a stale one causes the skill to be invoked for the wrong task or skipped for the right one — a failure that never surfaces when reading the skill itself, only when something else picks it.

Treat these as description-affecting changes: gaining or losing an outcome (e.g. a skill that only fixed things now also rejects them), a change of scope (operating on a narrower or wider set of inputs), or a change in what the skill refuses to do. Reformatting, clarifying, or adding detail to an existing documented behavior does not require a description change. Flag a body change that adds or removes a documented behavior while the `description` line is untouched.

### Skill Tool Declarations

**GEN-010** — Every command a `SKILL.md` instructs the agent to run must be covered by that skill's `allowed-tools` frontmatter, and — where the skill is meant to run unattended — by the `permissions.allow` list in `.claude/settings.json`. This is easy to violate while fixing something else: editing a shell snippet to add a helper such as `wc`, `tr`, `sed`, or `xargs` introduces a command the declarations do not cover, and the skill then stalls on a permission prompt at exactly the step that was just repaired.

Check the two directions separately, because they fail differently:

- A command in a snippet that is **missing** from `allowed-tools` blocks the skill at runtime.
- An entry in `allowed-tools` that **no snippet uses** grants the skill more than it needs and should be removed.
- A command that is declared but **written so it cannot match** is the subtlest of the three, because the declaration looks correct. Since rules match the command string from the left (**GEN-008**), an environment-variable prefix moves the command name out of first position: `SINCE="$x" gh api ...` begins with `SINCE=`, so it matches no `Bash(gh api:*)` rule and prompts despite `gh api` being allowlisted. Write the snippet so the command name comes first and pass values by flag — `gh api ... | jq --arg since "$x" ...` — rather than by env prefix.

When a change adds a command to a snippet, verify it appears in `allowed-tools`, in `settings.json` if the skill runs unattended, and in any documentation that enumerates the allowed commands.

### Deny Versus Prompt

**GEN-011** — Do not deny a command in order to make it prompt. A `deny` rule **refuses** a command outright, with no opportunity to approve it; a command matching **no allow rule** is what produces a prompt. The two are frequently confused because both stop an unattended run, but they differ exactly where it matters: a denied command can never proceed, so denying one that a hand-invoked skill legitimately needs does not add a confirmation step to that skill — it breaks the skill.

Before adding a `deny` entry, check whether any documented workflow in the repository issues that command. If one does, the correct action is to leave it off the `allow` list and add no deny rule at all:

```jsonc
// wrong — /rebase can no longer push, and no prompt is offered
"deny": ["Bash(git push --force-with-lease:*)"]

// right — not allowlisted, so it prompts when invoked by hand
// and stays unreachable in unattended runs
"allow": ["Bash(git push)", "Bash(git push -u origin HEAD)"]
```

Reserve `deny` for commands no workflow in the repository should ever run. Flag any documentation that describes a deny rule as causing a prompt.

### Paginated GraphQL Connections

**GEN-012** — A GraphQL connection fetched with a bare `first: N` must not be treated as complete. GitHub returns at most `N` items and reports the rest only through `pageInfo`, so a query like `reviewThreads(first: 100)` silently truncates on the 101st item. The resulting bug is always a **false negative** — items that exist are reported as absent — which is the failure mode least likely to be noticed, because the output looks like a clean empty result rather than an error.

Declare a cursor variable and return `pageInfo` so `gh api graphql --paginate` can walk every page:

```graphql
# wrong — truncates at 100, silently
reviewThreads(first: 100) { nodes { id isResolved } }

# right — --paginate follows the cursor to the end
reviewThreads(first: 100, after: $endCursor) {
  pageInfo { hasNextPage endCursor }
  nodes { id isResolved }
}
```

The query must also declare `$endCursor: String` in its variable list. Note that `--paginate` emits **one JSON document per page**, so collect nodes across pages before counting or filtering — the same aggregation trap as **GEN-007**:

```sh
gh api graphql --paginate -f query='...' -F owner=o -F repo=r -F number=1 \
  | jq -s '[.[].data.repository.pullRequest.reviewThreads.nodes[]]'
```

Apply this wherever a truncated result would be read as authoritative: counts, completeness checks, and any audit that reports "nothing found".

### Pull Request Descriptions

**GEN-013** — A pull request's title and description must describe the change as it stands at review time, not as it was first proposed. This repository squash-merges, so the PR title and body become the commit message on `main` — a claim that was true in the first push and falsified by a later one does not merely mislead a reviewer, it lands in the permanent history of the default branch, where nothing later corrects it.

Re-read the description whenever the diff changes materially: a behavior removed, a mechanism replaced, a file no longer touched, a rationale that no longer holds. Flag any statement in the description that the final diff contradicts, quoting both. This applies with equal force to claims about configuration and security posture, where a reviewer is most likely to trust the summary instead of re-deriving it from the diff.

### Code Comments

**GEN-014** — A comment must explain **why** the code is the way it is, not **what** it does. Both humans and coding agents read these comments, and both can already read the code — what neither can recover from the code is the reasoning that produced it: the business rule it encodes, the technical constraint it works around, the alternative that was tried and failed. That reasoning is what a future change needs in order to know whether the line may be altered, and it is lost the moment it is not written down. A comment restating the mechanics adds nothing recoverable and goes stale as soon as the line beneath it changes, so it eventually misleads.

Comments must also be short, succinct, and accurate. Prefer one or two lines placed directly above the code they justify. Accuracy is required rather than encouraged: an incorrect comment is worse than no comment, because it is trusted.

Flag these:

- A comment that paraphrases the statement below it (`// increment the counter`, `// loop over the users`).
- A comment that contradicts the code it sits above, or describes behavior the diff has since changed.
- Commented-out code left in place; the history holds it, and it is not obvious to a later reader whether it is dead or pending.
- A non-obvious constant, workaround, retry, ordering dependency, or deviation from a rule in this file that carries **no** comment explaining why. Several rules already require this explicitly (**TS-008**, **DDB-001**, **UI-001**).

Do not flag the absence of a comment on code whose intent is evident, and do not ask for comment volume — this rule is not a license to override the "do not comment on comment density" guidance above.

Example — prefer:

```ts
// Plaid caps transfer descriptions at 15 characters; longer values are
// rejected at authorization time rather than truncated.
const description = memo.slice(0, 15);
```

over:

```ts
// truncate the memo to 15 characters
const description = memo.slice(0, 15);
```

---

## TypeScript / JavaScript

### File Naming

**TS-001** — TypeScript and JavaScript file names should be kebab cased and may only contain lowercase letters, numbers, and hyphens. For example, `my-file.ts` is allowed but `MyFile.ts` and `my_file.ts` are not.

### File Extensions

**TS-008** — TypeScript source files must use the `.ts` (or `.tsx`) extension. The `.mts` and `.cts` extensions must not be used unless required by a tooling constraint that cannot be resolved another way; in that case, the constraint must be documented in a comment at the top of the file.

### Package Manager

**TS-002** — All TypeScript and JavaScript projects must use [pnpm](https://pnpm.io/). npm is not allowed. `package-lock.json` files must not be committed.

**TS-010** — The root `package.json` of the workspace must not declare `dependencies` or `devDependencies`. It is reserved for workspace-level configuration (`packageManager`, `pnpm` settings, catalogs, scripts). Dependencies must be declared in the individual project `package.json` that consumes them, using `catalog:` references where applicable.

**TS-015** — Adding a dependency does not by itself warrant a review comment, and you must not ask the author to "confirm" or pre-approve a new dependency. The only dependency concern in this repository is the **runtime bundle size of the deployed artifact** (e.g. an AWS Lambda, ECS, or Kubernetes image) — never CI duration, install time, or repository size. Therefore:

- Do **not** flag a `devDependencies` addition on bundle-size, CI-impact, or "confirm first" grounds. Dev-only packages (test, build, and tooling dependencies such as `testcontainers`, `vitest`, and `@types/*`) are never included in a deployed runtime bundle, so their size is irrelevant.
- Only raise a dependency concern when a package is added to a project's runtime `dependencies` **and** that project is bundled and deployed **and** the package is large enough to materially affect the deployed artifact's size. Even then, cite this rule and frame it as a `should`-level suggestion, not a required change.

### Formatting and Linting

**TS-009** — All TypeScript projects must use [Biome](https://biomejs.dev/) for formatting and linting. The repository is migrating off the legacy Prettier + ESLint toolchain (**TS-003**, **TS-004**, **TS-006**); every new project, and any project being modified that has not yet migrated, must use Biome. A Biome project must:

- contain a `biome.json` configuration file;
- set its `prebuild` script to `biome check` (this satisfies the `prebuild` requirement in **TS-005**);
- depend on `@biomejs/biome` and **not** retain `.prettierrc`, `.prettierignore`, `eslint.config.mjs`, or the `prettier` / `eslint` / `@eslint/js` / `typescript-eslint` dev dependencies.

A project must use exactly one toolchain: a Biome project must not also carry Prettier/ESLint config files, and a not-yet-migrated Prettier/ESLint project must not carry a `biome.json`.

#### Legacy: Prettier (deprecated)

**TS-003** — _Deprecated; superseded by **TS-009**._ Prettier has been replaced by Biome. New projects must not add Prettier. A project that has not yet migrated keeps its existing `.prettierrc`, which must contain at least the following until it is removed during migration:

```json
{
  "singleQuote": true,
  "quoteProps": "consistent",
  "bracketSpacing": false
}
```

#### Legacy: ESLint (deprecated)

**TS-004** — _Deprecated; superseded by **TS-009**._ ESLint has been replaced by Biome. New projects must not add ESLint. A project that has not yet migrated keeps its existing `eslint.config.mjs`, which must include at minimum the following until it is removed during migration:

```js
eslint.configs.recommended,
tseslint.configs.recommended,
```

### package.json Scripts

**TS-005** — All `package.json` files inside a TypeScript project must define at minimum the following scripts: `prebuild`, `build`, `test`, `clean`, `fmt` and `reset`.

**TS-006** — _Deprecated; superseded by **TS-009**._ New and migrated projects use `"prebuild": "biome check"`. A project that has not yet migrated off Prettier + ESLint keeps its `prebuild` script as:

```json
"prebuild": "prettier --check . && eslint ."
```

### Validation Library

**TS-007** — All TypeScript projects must use [valibot](https://valibot.dev/) for schema validation. Zod must not be used.

**TS-012** — A valibot field that is both optional and nullable must use `v.nullish(...)` rather than chaining `v.optional(v.nullable(...))`. The two are equivalent, but `v.nullish` is the canonical single-wrapper form.

Example — prefer:

```ts
invoiceTotal: v.nullish(v.pipe(v.string(), amountValidator)),
```

over:

```ts
invoiceTotal: v.optional(v.nullable(v.pipe(v.string(), amountValidator))),
```

**TS-013** — Data normalization (trimming, lowercasing, canonicalizing, defaulting, coercing) should generally be handled inside the valibot schema with `v.transform` rather than in ad-hoc helper functions scattered across call sites. The schema is the single source of truth: the raw, pre-normalization shape is the schema's `v.InferInput` type and the normalized shape it produces is its `v.InferOutput` type. Both types must be exported alongside the schema (see **GQL-002**, **GQL-003**), and downstream code must consume the `InferOutput` value (e.g. the result of `v.parse` / `safeParse`) rather than re-normalizing the input itself. When the same normalized value is needed in more than one place (for example, validating a write and later comparing a lookup against it), reuse the one exported schema in every path so the normalization cannot drift.

Example — normalize in the schema, not at the call site:

```ts
// origin URL is trimmed by nonEmptyString, then canonicalized to its origin
// serialization; callers receive the normalized form via InferOutput.
export function originUrlSchema(locale?: Locale) {
  return v.pipe(
    nonEmptyString(locale),
    v.check((value) => isValidOrigin(value), m.v_invalidUrl({}, { locale })),
    v.transform((value) => new URL(value).origin),
  );
}
export type OriginUrlSchemaInput = v.InferInput<
  ReturnType<typeof originUrlSchema>
>;
export type OriginUrlSchemaOutput = v.InferOutput<
  ReturnType<typeof originUrlSchema>
>;
```

### Client Libraries

**TS-011** — API client packages under `clients/` must support tree-shaking. A client package must:

- be ESM (`"type": "module"`) and declare `"sideEffects": false` in its `package.json`;
- expose each API module as a subpath export (e.g. `@nr1e/plaid/transfer`) in addition to the root export;
- implement each operation as a standalone exported function (one operation per file) that takes the client as its first argument — not as a method on a class;
- have zero runtime dependencies, using native `fetch` for HTTP;
- not perform side effects at module scope;
- use string-literal union types instead of TypeScript `enum`s, which emit runtime objects that cannot be tree-shaken.

### Testing

**TS-014** — The `@int` tag is reserved for tests that communicate with an external service that **cannot** be run inside the CI/CD pipeline — for example a live third-party API or a real cloud account. Only those tests are integration tests for this purpose: they must include `@int` in the test name, are excluded from the default `test` script, and run via a separate `test:int` script.

A test that stands up its own dependency locally — most commonly via [Testcontainers](https://testcontainers.com/) (e.g. DynamoDB Local) — is **not** an `@int` test. Such tests run inside CI like any other test, must **not** be tagged `@int`, and run under the normal `test` script. Do not tag a test `@int` merely because it is out-of-process or uses a container; tag it only when the dependency it talks to cannot be provisioned in CI.

### Presence Checks

**TS-016** — Do not use a truthiness check (`!value` or `if (value)`) to test whether a **numeric or boolean** field is present, because `0` and `false` are valid values that a truthiness check wrongly treats as missing. Use an explicit nullish check (`value == null`, or `value === undefined` / `value === null`) instead. This applies wherever a nullable/optional number or boolean is validated, defaulted, or branched on. String presence checks that intentionally reject the empty string are exempt, but must be written explicitly (e.g. `value === ''`) rather than relying on truthiness, so the intent is clear.

Example — prefer:

```ts
if (owner.percentageOwnership == null) {
  throw new Error('Application missing owner percentage ownership');
}
```

over:

```ts
if (!owner.percentageOwnership) {
  throw new Error('Application missing owner percentage ownership');
}
```

---

## Python

### Style Guide

**PY-001** — All Python code must follow the [PEP 8](https://peps.python.org/pep-0008/) style guide.

---

## GraphQL

### Type Conventions

The following type conventions apply when working with GraphQL.

#### "Schema" type

**GQL-001** — Valibot schemas are defined in the client for all "input" types. They should end in `Schema`. So if you have an input in your GraphQL schema defined as `CreateUserInput`, you will get a generated interface called `CreateUserInput` from gqty. You would then create a schema called `CreateUserInputSchema`.

#### "SchemaInput" type

**GQL-002** — You must create an input type for each Valibot schema.

Example:

```ts
type CreateUserInputSchemaInput = v.InferInput<typeof CreateUserInputSchema>;
```

#### "SchemaOutput" type

**GQL-003** — You must create an output type for each Valibot schema.

Example:

```ts
type CreateUserInputSchemaOutput = v.InferOutput<typeof CreateUserInputSchema>;
```

**GQL-004** — All input types should be validated before being used inside the GraphQL resolver functions.

#### "Detail" type

**GQL-005** — For DynamoDB records using a `Detail` field, a type ending in `Detail` should be created. So if you have a `createUser` GraphQL mutation that stores a user object in the `Detail` field of a DynamoDB record, you should have a type defined as `UserDetail`.

#### "View" type

**GQL-006** — You should have operational types defined for gqty client functions that call mutations and queries on the GraphQL API. So if you have a function called `getUser`, you should have a return type called `UserView`.

### Relay Specification

Reference these Relay docs when reviewing or generating GraphQL schema changes:

- https://relay.dev/graphql/connections.htm
- https://relay.dev/docs/guides/graphql-server-specification/

**GQL-007** — GraphQL fields that expose paginated collections must follow the Relay Cursor Connections Specification. Do not introduce raw list fields for paginated data when a Relay connection should be used instead.

**GQL-008** — Relay connection types must end in `Connection` and expose `edges` plus a non-null `pageInfo` field. `pageInfo` must use the Relay `PageInfo` shape.

**GQL-009** — Relay edge types must end in `Edge` and expose a `node` field plus a non-null `cursor` field. Cursors must be treated as opaque values.

**GQL-010** — Relay connection fields must accept Relay pagination arguments: `first` and `after` for forward pagination, and `last` and `before` for backward pagination.

**GQL-011** — Relay-style refetching — the `Node` interface and the root `node(id: ID!)` field — is **optional**, decided per application. A type that opts in must expose an `id: ID!` from which the `node` resolver can recover the type. Because **GQL-014** forbids a type segment in the id itself, that recovery is server-side — a registry keyed by the opaque id, or a lookup across the types that opted in — and never a prefix parsed back out of the id. Which of those an application uses is its own design, not this rule's. A type that does not opt in must not implement `Node`, and fetches one record through a typed root field instead (`note(id: ID!)`, `contact(id: ID!)`); its `id` need only be unique within its own type. Do not flag a type for lacking `Node` or a schema for lacking `node(id:)`.

### Public API Compatibility

**GQL-012** — Changes to public graph APIs must be backward-compatible. Do not remove or narrow existing fields, arguments, enum values, or types in ways that break existing clients; prefer additive changes and deprecate old API surface before removal.

### Validation Placement

**GQL-013** — Input validation must live in the client package that corresponds to the graph component, never inline in the server/resolver code. The architectural intent is that the **same** validation is shared between the frontend and the backend: the frontend client validates user input before sending a request, and the server re-validates the same input with the same schema (see **GQL-004**), so both reject the same inputs for the same reasons. Each component's valibot input schemas (per **GQL-001**) are defined once in its client and imported by the server rather than redefined there.

Which client a schema belongs in follows where the graph component itself lives:

- **Shared graph components** — those in `lib/src/graph` — pair with the shared client `@nr1e/client` (e.g. `@nr1e/client/origin`).
- **Project-specific (non-shared) graph queries and mutations** pair with that project's own client packages: `<project>/client-public` for operations on the project's public graph and `<project>/client-private` for operations on its private graph (e.g. `@upgility/client/workspace` for a public workspace operation). They must not go in `@nr1e/client`, and not in the graph package.

Reusing the catalog `valibot` and the shared `@nr1e/commons/valibot` helpers keeps the schemas consistent across packages.

### ID Generation

**GQL-014** — An `id` is an opaque string the server mints with a shared id generator. It carries no type segment, category or other prefix: the default id, and what a new type uses unless it has a reason not to, is a bare **KSUID** (27 base62 characters). A **UUIDv7** is permitted where an entity needs finer time ordering than a KSUID's one-second resolution, and a **UUIDv4** where an id must match or be shared with an external system that uses one; either choice must be deliberate, and its reason recorded in a comment where the id is minted (**GEN-014**). Sequential or otherwise enumerable ids must not be used.

Clients must treat an `id` as opaque. Do not document its layout in the schema — a described format is one clients will parse — and do not derive anything from it server-side that a stored field could carry instead: the type of a record comes from where it was fetched, not from its id.

Ordering is the one thing an id may legitimately carry. Both default bodies sort chronologically as strings — a KSUID to the second, a UUIDv7 to the millisecond — so either may be ordered on. Prefer an explicit timestamp attribute where the record can carry one: it survives a change of id scheme, it is visible to clients, and it can express a time the id does not (when an event occurred, rather than when its row was minted). Order on the id where no such field exists, or where the id is the tiebreaker within one timestamp. A UUIDv4 carries no time and must never be ordered on.

A storage layer may prefix keys with the entity type for single-table design (`Pk = Note#<id>`), but that prefix belongs to the key, not the id: the stored record and the API carry the bare id, and the prefix is applied when a key is built and never parsed back out of one. Flag an id that is stored or served with a storage prefix attached.

Records minted under an earlier scheme — a type-prefixed `<Type>#<id>`, for example — keep the form they were written with, because stored ids are permanent. An existing type continuing to mint in its established form is not a violation, and the generator call that does so is load-bearing. This rule governs the ids a **new** type mints; flag an established form only when a diff introduces a new type through it.

Example — a note, its storage key, and how a caller that needs another scheme opts in:

```ts
// default — the id is a bare KSUID
const id = await ksuid();                   // '3C7tjIhKSFkG0v8CDCaGUq8Wpgs'
const pk = `Note#${id}`;                    // storage key; never served

// deliberate deviation, reason recorded
// Audit events are ordered by id in the export feed, which needs millisecond
// resolution a KSUID does not carry.
const id = uuidv7();
```

### Global ID Generation

**GQL-015** — _Retired._ Global ids are no longer required; **GQL-014** governs id generation. Nothing to flag under this code.

### Pagination Argument Direction

**GQL-016** — A connection resolver, or the store call beneath it, must reject a request that mixes forward and backward pagination arguments (`first`/`after` together with `last`/`before`) rather than pick one direction and silently ignore the rest. The Relay specification leaves mixed arguments to the server, and the common implementation — `const forward = last == null` — quietly drops `first` or `after` when `last` is present, so a client bug produces a plausible page instead of an error. Validate the pair in the schema that admits the arguments, and derive the direction from both backward arguments (`last == null && before == null`), so `before` alone pages backward instead of being ignored. Flag a direction selector that reads only one argument, and an input schema that admits all four without a cross-field check.

```ts
// wrong — `first: 10, last: 5` pages backward and never says so
const forward = params.last == null;

// right — a mix is a validation error; either backward argument selects backward
v.check(
  (p) => (p.first == null && p.after == null) || (p.last == null && p.before == null),
  'first/after cannot be combined with last/before',
);
const forward = params.last == null && params.before == null;
```

---

## AWS CDK

### Library

**CDK-001** — All AWS CDK code must use [`truemark-cdk-lib`](https://github.com/truemark/public/tree/main/cdk) constructs where available in addition to `aws-cdk-lib`. Prefer `truemark-cdk-lib` wrappers over raw `aws-cdk-lib` constructs when both exist.

### Stacks

**CDK-002** — CDK stacks must extend `ExtendedStack` from `truemark-cdk-lib/aws-cdk`, not `Stack` from `aws-cdk-lib`. Props interfaces must extend `ExtendedStackProps`, not `StackProps`.

Example:

```ts
import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';

export interface MyStackProps extends ExtendedStackProps {
  // ...
}

export class MyStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: MyStackProps) {
    super(scope, id, props);
    // ...
  }
}
```

### Stages

**CDK-003** — CDK stages must extend `ExtendedStage` from `truemark-cdk-lib/aws-cdk`, not `Stage` from `aws-cdk-lib`. Props interfaces must extend `ExtendedStageProps`, not `StageProps`.

Example:

```ts
import {ExtendedStage, ExtendedStageProps} from 'truemark-cdk-lib/aws-cdk';

export interface MyStageProps extends ExtendedStageProps {
  // ...
}

export class MyStage extends ExtendedStage {
  constructor(scope: Construct, id: string, props: MyStageProps) {
    super(scope, id, props);
    // ...
  }
}
```

### Lambda Runtimes

**CDK-004** — Lambda functions must use the latest supported Node.js runtime (currently `Runtime.NODEJS_24_X`). Older runtimes such as `Runtime.NODEJS_20_X` and `Runtime.NODEJS_22_X` must not be used for new or updated functions.

### Cross-Stack Parameters

**CDK-006** — Do not use `CfnOutput` to pass variables between stacks. Use the `exportParameter` method provided by `ExtendedStack` (from `truemark-cdk-lib`), which stores the value in SSM Parameter Store and can be consumed by other stacks without creating CloudFormation export/import coupling.

Example:

```ts
// In the producing stack (extends ExtendedStack)
this.exportParameter(MyStackParameterExport.ApiUrl, api.graphqlUrl);
```

### Imports

**CDK-005** — CDK code must use named imports instead of namespace imports. Avoid `import * as ...` unless it is required to resolve a naming conflict.

Example — prefer:

```ts
import {Duration} from 'aws-cdk-lib';
import {Architecture, Runtime} from 'aws-cdk-lib/aws-lambda';
```

over:

```ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
```

### Resource Retention on Construct Replacement

**CDK-007** — When a change replaces one stateful construct (a table, bucket, or similar) with another, the resulting `removalPolicy` and `deletionProtection` must be compared against the construct being replaced. Wrapper constructs carry their own defaults — `truemark-cdk-lib`'s `StandardTableV2`, and the shared constructs built on it, default to `RemovalPolicy.RETAIN` with deletion protection **on** — so replacing code that set a policy literally with code that forwards an optional prop silently adopts the wrapper's default wherever no caller supplies one.

Flag a diff where the old code sets the policy literally and the new code forwards `props.removalPolicy` (or omits it) with no `??` fallback. Check it mechanically: find the construct's instantiation sites, and if no stage or parent stack passes `removalPolicy`, the value is always `undefined` and the wrapper's default is what ships — in every environment, not just production. A pass-through that is correct in one stack is not automatically correct in another; it works only where some caller actually sets the prop.

```ts
// wrong — the enclosing stage never passes removalPolicy, so RETAIN and
// deletion protection apply everywhere, unlike the table this replaced
const table = new SessionTable(this, 'Session', {
  removalPolicy: props.removalPolicy,
});

// right — prior behavior is preserved when no caller sets the prop
const table = new SessionTable(this, 'Session', {
  removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
});
```

This applies with particular force when the replacement also fixes the physical name (`tableName`, `bucketName`): a retained resource keeps that name, so destroying and recreating the stack then fails on a name collision.

---

## DynamoDB

### Data Access

**DDB-001** — DynamoDB access must go through [`dynamodb-toolbox`](https://www.dynamodbtoolbox.dev/) `Table` and `Entity` constructs and their actions (e.g. `GetItemCommand`, `PutItemCommand`, `UpdateItemCommand`, `QueryCommand`). Do not issue direct calls against the raw AWS SDK clients (`@aws-sdk/client-dynamodb` or `@aws-sdk/lib-dynamodb` `DynamoDBDocumentClient`) for reads or writes when a `dynamodb-toolbox` equivalent exists. Reach for the raw SDK only when `dynamodb-toolbox` does not support the operation (for example, table administration or a control-plane API it does not wrap); when you do, keep it to that operation and cite the reason in a comment.

### Conditional Writes

**DDB-002** — A read-back that recovers from a `ConditionalCheckFailedException` must be a **strongly consistent** read. The idiom — attempt a conditional write, and when the condition fails because the row already exists, read that row and return it — is how a create is made idempotent. It carries a trap specific to this situation: the row being read is by definition the one whose write just collided, so it is typically only seconds old, and DynamoDB's default eventually-consistent read can still miss a write that recent. The read then finds nothing, the code rethrows, and the duplicate the handler exists to absorb surfaces as an error — intermittently, and only under the concurrency the idempotency was written for, which is precisely when it is hardest to reproduce.

Pass `consistent: true` on a `dynamodb-toolbox` `GetItemCommand`, or `ConsistentRead: true` when **DDB-001** justifies the raw SDK:

```ts
// wrong — the shared getter is eventually consistent, so it can miss the row
} catch (error) {
  if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
    const existing = await getThing(entity, id);
    if (existing) return existing;
  }
  throw error;
}

// right — read the same key strongly
} catch (error) {
  if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
    const result = await entity
      .build(GetItemCommand)
      .key({ id })
      .options({ consistent: true })
      .send();
    if (result.Item) return result.Item.detail;
  }
  throw error;
}
```

Reusing a shared non-consistent getter (`getThing`, `getWlgTransaction`) is the usual way this is violated, because the call reads as obviously correct at the call site. Flag it wherever a conditional-write failure is recovered from, not only on create.



**QWIK-001** — `routeLoader$()` must be declared in route boundary files (`layout.tsx`, `index.tsx`, or `plugin.tsx`) inside the `src/routes` directory. It must not be declared in component files outside of `src/routes`, nor in route files with any other name.

### Pagination Cursors

**DDB-003** — A pagination cursor decoded from a client must be checked against the partition being queried before it is passed as `ExclusiveStartKey`. A cursor is an opaque, signed-by-nobody copy of a DynamoDB key, so a well-formed cursor from a different partition (another owner's listing, or a stale cursor after the caller changed filters) reaches the query intact — and DynamoDB rejects a start key outside the queried partition with a `ValidationException`, which surfaces to the client as an internal error instead of a bad request. Decode, then compare the cursor's partition key (and index partition key, for a GSI query) to the values the query is about to use, and fail with the same client-safe validation error a malformed cursor gets.

```ts
// wrong — a cursor from another owner reaches DynamoDB and fails as a 500
exclusiveStartKey: cursor ? decodeCursor(cursor, field) : undefined,

// right — a cursor for a different partition is a bad request
const partition = ownerPartition(ownerId);
exclusiveStartKey: cursor ? decodeCursor(cursor, field, partition) : undefined,
```

### Key Ordering

**DDB-004** — Code and tests that reproduce DynamoDB's sort-key order must compare strings by their UTF-8 bytes, never with `localeCompare` or a locale-aware collator. DynamoDB orders string keys by their UTF-8 bytes, so uppercase sorts before lowercase and digits before letters; a locale collation orders case-insensitively and can interleave them, so an expectation built with `localeCompare` disagrees with the index exactly when two keys share a prefix and differ in case — a KSUID, a base62 id, or a mixed-case name. The failure is intermittent, which is why it survives into CI.

JavaScript's `<` and `>` compare UTF-16 code units, which agrees with UTF-8 byte order only while every key stays inside the BMP. Above it the two disagree: `'\u{10000}' < '\uE000'` is `true`, but U+10000 encodes as `f0 90 80 80` against U+E000's `ee 80 80`, so the index returns the opposite order. Keys drawn from an ASCII alphabet — a KSUID, a base62 id, a type prefix — are safe to compare with `<`; a key that can carry arbitrary text, such as a user-supplied name with an emoji in it, must be compared bytewise.

```ts
// wrong — collation order, not key order
records.sort((a, b) => a.sk.localeCompare(b.sk));

// right, for an ASCII-only key — code-unit order matches byte order
records.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));

// right for any key — the order the index actually returns
const enc = new TextEncoder();
const byUtf8 = (a: string, b: string) => {
  const x = enc.encode(a);
  const y = enc.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
};
records.sort((a, b) => byUtf8(a.sk, b.sk));
```

### Composite Keys

**DDB-005** — A key built by joining several values with a delimiter must encode that delimiter (and the escape character) inside each value before joining, or reject values that contain it. Otherwise the join is not injective — `('A#B', 'C')` and `('A', 'B#C')` both produce `A#B#C` — and two distinct records share a partition, so a listing returns one owner's items under another and a cursor for one resumes inside the other. The collision is invisible in tests, which never happen to pick colliding values, and only appears once a real id carries the delimiter — which type-prefixed ids such as `<Type>#<id>` always do. Percent-encoding is the usual choice: `%` → `%25`, then `#` → `%23`, applied per component. Flag a template literal that interpolates more than one caller-supplied value around a delimiter with no encoding or validation in between.

```ts
// wrong — a `#` in either value moves the boundary
const pk = `Note#${parentType}#${parentId}`;

// right — each component is recoverable, so the join is unambiguous
const seg = (v: string) => v.replace(/%/g, '%25').replace(/#/g, '%23');
const pk = `Note#${seg(parentType)}#${seg(parentId)}`;
```

### Replacing Collections in an Update

**DDB-006** — In a `dynamodb-toolbox` `UpdateItemCommand`, a list or map attribute assigned a plain array or object is **patched**, not replaced: a list is updated index-wise (`['c']` over `['a', 'b']` leaves `['c', 'b']`) and a map key-wise (`{}` removes nothing). To replace the whole value, wrap it in `$set(...)` from `dynamodb-toolbox/entity/actions/update/symbols`. The bug is silent — the write succeeds and the read-back looks plausible — and the code usually reads as if it replaces, so flag any update item that assigns an array or object to a list, map, set or record attribute without `$set`, and check the intent: a partial patch is legitimate, but it should be visibly deliberate.

```ts
// wrong — an index-wise patch that keeps trailing elements
.item({ pk, detail: { labelIds: parsed.labelIds } })

// right — replaces the list
.item({ pk, detail: { labelIds: $set(parsed.labelIds) } })
```

**DDB-007** — A paginated read that discards rows after reading them (a `FilterExpression`, or an application-side filter) and stops after a bounded number of pages must still hand back a position the caller can resume from when it returns **no items**. DynamoDB reports remaining data only through `LastEvaluatedKey`; if the only cursors a page exposes are those of the items in it, an empty page with `hasNextPage: true` leaves the caller nothing to continue from — it either stops early and reports the data absent, or re-issues the identical request until the cap is hit again. When the page is empty, encode the last evaluated key as the page's end cursor (a cursor need not point at a returned item, only at a valid position). Flag any page result that can report more data while every cursor it exposes is null.

```ts
// wrong — an empty capped page reports more data with no way to reach it
endCursor: items.at(-1)?.cursor ?? null,
hasNextPage: lastEvaluatedKey != null,

// right — an empty page resumes from where the scan stopped
endCursor:
  items.at(-1)?.cursor ??
  (lastEvaluatedKey ? encodeCursor(lastEvaluatedKey) : null),
```

**DDB-008** — A caller-supplied value interpolated into a **`dynamodb-toolbox` attribute path** — a map key addressed as `tags['<id>']`, or any `attr` string built from input — must be validated to exclude the path form's delimiter (`'` for the bracket-quoted form) before it is interpolated, or the path must be built from parsed segments instead. This is the library's path grammar, not DynamoDB's: raw expressions have no quoted-key form and reach a key with a special character through `ExpressionAttributeNames` (`#tags.#key`), which the library generates from the parsed path. The bracket-quoted form protects dots and brackets inside a key, but the parser takes the next `'` as the end of the segment, so an embedded quote silently shifts where the segment ends and the path addresses an attribute the caller never named. Flag a template literal that places an unvalidated input inside a quoted path segment; a schema that rejects the delimiter at the boundary satisfies this.

```ts
// wrong — the id is only trimmed, so x'y reaches the path
const attr = `detail.tags['${tag.id}']`;

// right — the schema the id passed through excludes the delimiter
export const tagIdSchema = v.pipe(
  v.string(),
  v.trim(),
  v.check((id) => !id.includes("'"), 'a tag id must not contain a single quote'),
);
```

**DDB-009** — Every caller-supplied string that is written into a DynamoDB item must be bounded by the schema that admits it, so that an oversized value fails as the store's own validation error rather than as DynamoDB's `ValidationException`. DynamoDB enforces hard limits — 400 KiB per item, 2 KiB per partition key and 1 KiB per sort key, all counted in UTF-8 bytes — and an unbounded `v.string()` reaches them at write time, where the failure surfaces as an internal error with no field attached. Bound a body by its UTF-8 byte length, not its character count (a three-byte character counts three times), and bound a value that is joined into a key by what the key can hold once every component is at its maximum and encoded (**DDB-005** expands `#` to three bytes). Flag a string schema with no byte check whose output is stored in an item or interpolated into a key. A plain `maxLength` does not satisfy this on its own — `maxLength(2048)` still admits 2048 four-byte characters, which is 8 KiB — and counts only where the schema also restricts the value to a single-byte alphabet.

```ts
// wrong — a 1 MiB body reaches DynamoDB and fails there
export const contentSchema = v.pipe(v.string(), v.nonEmpty());

// right — the store rejects it with a field-level error first
export const MAX_CONTENT_BYTES = 256 * 1024;
export const contentSchema = v.pipe(
  v.string(),
  v.nonEmpty(),
  v.check(
    (value) => new TextEncoder().encode(value).length <= MAX_CONTENT_BYTES,
    `content must be at most ${MAX_CONTENT_BYTES} bytes of UTF-8`,
  ),
);
```

---

## Lit

### Property and Attribute Naming

**LIT-001** — Lit components use kebab-case for HTML element names and attributes; the TypeScript properties they map to are camelCase. The idiomatic pattern is therefore: camelCase property in TypeScript, kebab-case attribute in HTML, and an explicit `attribute: 'my-attribute'` in the `@property` decorator whenever the property name is multi-word. Lit lower-cases multi-word camelCase properties by default (e.g. `myProp` → `myprop`), which silently breaks attribute-driven usage; the explicit `attribute` option keeps the HTML form readable and matches the standard custom-elements convention.

Example — prefer:

```ts
@property({attribute: 'my-attribute'})
myAttribute = '';
```

over:

```ts
@property()
myAttribute = '';
```

### Event Naming

**LIT-002** — The canonical name of every event dispatched from a native web component must be kebab-case. This matches the convention used by built-in DOM events (e.g. `click`, `input`, `pointerdown`) and keeps event names consistent with the kebab-case attribute and element naming used elsewhere in the platform. A component may additionally dispatch a legacy camelCase alias of the same event for backward compatibility with existing integrations; when it does, both forms must be emitted together with the same `detail` so external listeners on either name observe identical behavior. Legacy aliases should be removed once all known consumers have migrated to the kebab-case name.

Example — prefer:

```ts
this.dispatchEvent(new CustomEvent('value-changed', {detail: value}));
```

over:

```ts
this.dispatchEvent(new CustomEvent('valueChanged', {detail: value}));
```

Allowed when an external integration still listens for the legacy name:

```ts
this.dispatchEvent(new CustomEvent('value-changed', {detail: value}));
// Legacy alias — remove once consumers migrate.
this.dispatchEvent(new CustomEvent('valueChanged', {detail: value}));
```

---

## User Interface

### Styling

**UI-001** — User interfaces must be styled with [Tailwind CSS](https://tailwindcss.com/) utilities and [daisyUI](https://daisyui.com/) component classes. Do not write vanilla CSS when a Tailwind or daisyUI equivalent exists, and do not ship hand-written stylesheets for component styling. Reach for raw CSS only where no utility/component equivalent applies (for example, defining a daisyUI theme, a Tailwind `@custom-variant`, or configuring a plugin); when you do, keep it to that configuration and cite the reason.
