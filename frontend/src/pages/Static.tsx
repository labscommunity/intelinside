import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { Block, Section } from '@/components/frame'
import { usePageTitle } from '@/hooks/usePageTitle'
import { BRAND_NAME, CASCADIA_URL, CATALOG_DIR_URL, REPO, REPO_URL } from '@/lib/brand'

const prose = 'max-w-2xl space-y-4 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4'

export function Guidelines() {
  usePageTitle('Guidelines')
  return (
    <div>
      <PageHeader eyebrow="Guidelines" title="What to submit, how it ranks, what gets flagged." />
      <Section>
        <Block className={prose}>
          <h2>What a result is</h2>
          <p>One model at one quantization, on one runtime, on either your whole rig or one part inside it. The headline number is decode speed in tokens per second. Prompt-processing speed and time to first token are welcome but optional.</p>
          <h2>How to measure decode tok/s</h2>
          <ul>
            <li>Follow the <a href={`${REPO_URL}/tree/main/results#standard-protocol`} target="_blank" rel="noreferrer">standard protocol</a>: a 512-token prompt, 256 generated tokens, one request, temperature 0, thinking, speculation and prompt cache off, one warm-up and then the mean of three runs. Record those conditions with the result so it joins the Standard board.</li>
            <li>Measure one request at a time. A throughput configuration — OpenVINO's <code>PERFORMANCE_HINT=THROUGHPUT</code>, vLLM serving many sequences at once, llama.cpp with parallel slots — reports the total across concurrent requests, which is a larger and different number from what one person sees waiting for one answer. If that is what you measured, record it as <code>concurrency</code> with <code>decodeScope</code> set to <code>total</code>: it ranks on the Throughput board instead of against single requests, and several request counts of the same setup draw a scaling curve on the rig page.</li>
            <li>Report the runtime version you used. An evidence link is optional: logs, scripts, a gist, a report, or a repository can help others check your result. Any full HTTPS URL works.</li>
            <li>Note the flags and settings that moved the number: the backend you compiled in, flash attention, KV cache precision. The same card on the same runtime can differ twofold on these.</li>
            <li>If you ran on one card out of several, submit it as a component result and set the quantity you used.</li>
            <li>A Core Ultra chip carries CPU cores, an iGPU, and an NPU, and each is its own part. Submit the unit the model ran on; a result on the CPU part means its cores. Use whole rig when the run spanned more than one unit.</li>
          </ul>
          <h2>Ranking</h2>
          <p>Boards are split into setups — Standard, Speculative, Long prompt, 4 requests and Throughput — each a fixed way of measuring. A result joins a setup only when the conditions it records match that setup's rules; a result with no conditions recorded appears only under All results. Within a setup, each rig, or each part at a given quantity, appears once at its best decode tok/s. The earliest run wins a tie. Boards mix runtimes; filter by runtime to compare like with like.</p>
          <h2>Stock and custom runtimes</h2>
          <p>A result either ran on a stock runtime — the released one, however you configured or built it — or on a <strong>custom runtime</strong>: one someone registered after changing it, with a custom kernel or op, a patch, or a fork. A custom runtime can beat stock by a wide margin on the same silicon, so boards rank stock runs against each other and leave custom ones out until you turn on <strong>Include modified</strong>. Nothing is hidden and they are not lesser; they answer a different question, rank among each other on the same board, and gather on the custom runtime's own page.</p>
          <p>Register a custom runtime once, from the submit form, and every later result just picks it. You can post a result on anyone's, not only your own — a public fork is a real thing anyone can run. Each result names the exact revision it used, because an implementation changes week to week and only the revision makes a number reproducible.</p>
          <h2>Verification</h2>
          <p>Every result starts self-reported. When enough signed-in members confirm it, it becomes community-verified. Confirm only what you reproduced or checked.</p>
          <h2>Flags</h2>
          <p>Flag numbers that look implausible, wrong hardware, duplicates, or spam. Past a few flags an entry is hidden until the team reviews it.</p>
          <h2 id="by-pr">Submitting by pull request</h2>
          <p>Prefer git? Add a JSON file under <code>results/your-handle/</code> in <a href={REPO_URL} target="_blank" rel="noreferrer">{REPO}</a> and open a pull request. A check verifies the result, your linked GitHub account, and rig ownership. Merging submits it automatically and keeps a link to the submission PR; no web form is needed. You can include an optional <code>evidenceUrl</code> alongside that link. The format is in the repo's <a href={`${REPO_URL}/tree/main/results`} target="_blank" rel="noreferrer">results folder</a>. Going the other way, every freshly submitted result offers "Add to the results repo", which writes the file for you.</p>
          <h2>Adding hardware or models</h2>
          <p>The catalog of hardware, models, runtimes, and quantizations lives in the same repo, in <a href={CATALOG_DIR_URL} target="_blank" rel="noreferrer">frontend/src/catalog</a>. Add the part or model there, open a pull request, and it appears on the site with the next deploy. The folder's README shows the shape of each entry.</p>
        </Block>
      </Section>
    </div>
  )
}

export function About() {
  usePageTitle('About')
  return (
    <div>
      <PageHeader eyebrow="About" title="A community leaderboard of AI inference on Intel hardware." />
      <Section>
        <Block className={prose}>
          <p>{BRAND_NAME} tracks how fast local models run on Intel silicon: Core Ultra chips with the iGPU and NPU on their package, Arc and Arc Pro cards, Xeon, and Gaudi. People sign in with GitHub, register the machines they run models on, and post the tokens per second they get for a model at a given quantization on a given runtime.</p>
          <p>Rigs decompose into parts, so a result can describe the whole machine or one unit inside it: a single card, the CPU cores, the iGPU, or the NPU. The same chip can hold three numbers, and the boards keep them apart.</p>
          <p>Results are self-reported and checked by the community. Nothing here is a lab benchmark, and that is the point: it is what people actually see on hardware they actually own.</p>
          <p>The hardware database is open source and grows by pull request. Intel parts are seeded and lead the boards; parts from other vendors are welcome alongside them, so the comparisons stay honest.</p>
          <p className="flex flex-wrap items-center gap-x-2">
            <span>{BRAND_NAME} is powered by</span>
            <a href={CASCADIA_URL} target="_blank" rel="noreferrer" className="inline-flex items-center no-underline!">
              <img src="/logos/cascadia-wordmark.svg" alt="Cascadia" className="h-4 w-auto" />
            </a>
          </p>
        </Block>
      </Section>
    </div>
  )
}

export function NotFound() {
  usePageTitle('Not found')
  return (
    <Block className="py-24 text-center">
      <div className="font-mono text-6xl font-semibold text-muted-foreground">404</div>
      <p className="mt-3 text-sm text-muted-foreground">That page does not exist, or it was hidden.</p>
      <Button className="mt-6" variant="outline" render={<Link to="/" />} nativeButton={false}>Back home</Button>
    </Block>
  )
}
