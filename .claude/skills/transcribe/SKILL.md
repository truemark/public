---
name: transcribe
description: Transcribe an audio or video file with the tools/transcribe CLI, prompting for the AWS profile when one is not provided
allowed-tools: Bash(pnpm:*), Bash(node:*), Bash(aws:*), Bash(ls:*), Bash(test:*), AskUserQuestion
arguments: [file]
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/transcribe
  version: 2026.07.16.0802
---

Transcribe the audio/video file `$file` by running this repository's
`tools/transcribe` CLI. The transcript is written next to the input file with the
same base name (e.g. `talk.mp4` → `talk.txt` and `talk.json`). The CLI stages the
media in S3, runs an AWS Transcribe batch job, downloads the result, and cleans
up — see [`tools/transcribe/README.md`](../../../tools/transcribe/README.md).

**Prompt for the AWS profile when it is not already provided.** AWS Transcribe
runs in a real account, so the tool needs credentials. If the user did not supply
a profile and `AWS_PROFILE` is not set, ask which profile to use before running —
never guess an account.

## Steps

1. Resolve the input file. `$file` is the path to the audio/video file to
   transcribe. If it is empty, ask the user for the file and stop until they
   provide one. If the path does not exist, report that and stop.

2. Resolve the **AWS profile**:
   - If the user passed a profile (e.g. as an argument or `--profile <name>`), use
     it.
   - Otherwise, if `AWS_PROFILE` is already set in the environment, use that and
     mention which one you are using.
   - Otherwise **prompt the user** for the profile. List the available profiles to
     choose from:
     ```sh
     aws configure list-profiles
     ```
     Present them (or a sensible subset) and wait for the user's choice. Do not
     proceed without a profile.

3. Resolve the **region**. Default to `us-west-2` unless the user specified one
   (the CLI also accepts `--region`). AWS Transcribe is available in `us-west-2`
   and `us-east-2`.

4. Confirm the chosen profile is authenticated. SSO profiles expire; check before
   running so the failure is clear:
   ```sh
   AWS_PROFILE=<profile> aws sts get-caller-identity --region <region>
   ```
   If this fails with an SSO/token error, tell the user to run
   `aws sso login --profile <profile>` themselves (it opens a browser — you cannot
   do it for them), then stop until they confirm they have logged in.

5. Ensure the CLI is built. The entry point is
   `tools/transcribe/dist/cli.js`. If it does not exist:
   ```sh
   test -d node_modules || pnpm install
   pnpm --filter transcribe build
   ```

6. Run the tool, passing the profile via the environment and the file plus region
   as arguments. Quote the file path (recordings often contain spaces):
   ```sh
   AWS_PROFILE=<profile> node tools/transcribe/dist/cli.js "<file>" --region <region>
   ```
   The job runs to completion (it can take a while for long recordings); let it
   finish. Pass through any extra options the user asked for (e.g. `--language`,
   `--format`, `--keep-remote`).

7. Report the result: the transcript files that were written (the CLI prints their
   paths on stdout) and the detected/used language. Note that the staged S3
   objects and the transcription job were cleaned up unless `--keep-remote` /
   `--keep-job` was passed.
