import { REPO } from '@/lib/brand'
import { RESULTS_DIR } from '@/lib/pr'

/*
  The prompt someone hands to their coding agent so it submits for them. The agent writes
  `results/<handle>/<name>.json` and opens a pull request from their own account; the ingestion check verifies the
  file, the account, and rig ownership, and merging inserts the result. There is no form to come back to.

  The account is why the prompt insists on the person's own GitHub session: a bot-authored pull request cannot be
  attributed to them, and the check will refuse it. Everything else the site knows is substituted here — the handle
  decides the folder, and the rig is named by the id the file format expects. The wording itself belongs to the
  agent pipeline, so this is the one string to edit when it lands.
*/
export function agentPrompt({ handle, rigId, rigName }: { handle: string; rigId: string; rigName: string }): string {
  const path = `${RESULTS_DIR}/${handle}/<name>.json`
  return `Submit my benchmark result to the Intelinside leaderboard.

Repo: https://github.com/${REPO}
Add one file at ${path} and open a pull request against main.

Open it with my own GitHub CLI session, as me. A pull request authored by a bot
cannot be attributed to my account and the check will refuse it.

The rig is already registered on the site, so name it as it is: "rig": "${rigId}" — my ${rigName}.
Read ${RESULTS_DIR}/README.md in that repo for the field list, and frontend/src/catalog/ for the model, quant
and runtime ids. Fill the file from my run: model, quant, runtime, runtimeVersion, decodeTps and runDate are
required; promptTps, ttftMs, runtimeFlags and revision (the engine commit) if the log has them. Also record how
it was measured, where the log or my setup says so: inputTokens, outputTokens, concurrency (and decodeScope when
above 1), decodeMethod, repeats, promptCache, thinking and speculative. Leave out anything you would have to guess.
If I have a published log, script, gist, report, or repository for the run, include its full HTTPS URL as
evidenceUrl. This is optional; omit it if unavailable. The submission PR is linked automatically.

Validate before you push:
  npm --prefix frontend run results:validate -- ${path}

Do not invent numbers. If a value is not in the log, ask me for it.

Once the pull request is open you are done: a maintainer merges it and the
result is inserted automatically. Do not submit anything on the website.`
}
