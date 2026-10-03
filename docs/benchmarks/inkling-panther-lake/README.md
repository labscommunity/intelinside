# Inkling on eleven Panther Lake systems

Cascadia's final Inkling autolab survey measured **60.286375 aggregate decode tokens/s at 88 concurrent streams**, with **46.874876 tokens/s including admission, prefill and drain**. At one stream the paired mean was **7.959989 tokens/s**; at fifteen streams it was **24.604266 aggregate tokens/s**. These are measurements of the whole eleven-node fleet.

The result files under [`results/t8/`](../../../results/t8/) contain all fifteen paired mixed-workload concurrency points. They use `batchSize` for concurrent requests and `ttftMs` for the pooled median time to first token. The [CSV](concurrency.csv) retains full-precision rates, observed ranges and latency quantiles.

## System and run

| Item | Recorded configuration |
|---|---|
| Model | [Thinking Machines Lab Inkling](https://huggingface.co/thinkingmachines/Inkling), 975B total / 41B active parameters; text path |
| Hardware | Eleven Intel Core Ultra X7 358H systems, each with an Arc B390 iGPU and nominal 64 GB RAM; 704 GB nominal across separate machines |
| Execution | CPU and iGPU; eleven pipeline stages with six of the 66 layers per stage; NPU unused |
| Network | 1 GbE |
| Weight formats | INT4 group-32 experts; INT8 attention projections and output head; FP16 fused arithmetic |
| Runtime | Experimental Cascadia Inkling engine; OpenVINO 2026.3.1; serving release `1790016660` |
| Binary SHA-256 | `9084392040688eaa6aa9ff6cf6d222f84e24e119e528d91920d12ddd106563c2` |
| Source snapshot | Cascadia `3189a189fe3428f5a6315a7eb67b13148ec314e2`, branch `autolab/inkling-fleet-perf` |
| Date | September 21, 2026 in America/Chicago; the final mixed phase starts September 22 UTC |
| Workload | Twelve deterministic prompt families, 23–48 prompt tokens, 128 generated tokens per request, temperature zero, 15 ms arrival spacing |
| Sample | Thirty completed mixed phases, two per concurrency, 1,510 requests and 193,280 generated tokens |

The source snapshot identifies the retained evidence and code. The serving release and binary hash identify the executable that was actually measured. Hardware and runtime details are recorded in the pinned [autolab overview](https://github.com/labscommunity/cascadia/blob/3189a189fe3428f5a6315a7eb67b13148ec314e2/autolab/README.md), [exact-kernel experiment](https://github.com/labscommunity/cascadia/blob/3189a189fe3428f5a6315a7eb67b13148ec314e2/autolab/experiments/029_decode_kernels_exact/verdict.md) and [collection environment](https://github.com/labscommunity/cascadia/blob/3189a189fe3428f5a6315a7eb67b13148ec314e2/autolab/experiments/046_final_performance/collection-environment.json).

## Paired concurrency curve

Rates are arithmetic means of the two phase rates. TTFT statistics pool requests from both phases. Decode per stream is aggregate decode divided by concurrency; it does not guarantee that rate for each request.

| Concurrent streams | Requests, both phases | Aggregate decode tok/s | Observed phase range | Decode tok/s/stream | Whole-phase tok/s | TTFT median / p95, seconds |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 24 | 7.96 | 5.68–10.24 | 7.960 | 6.98 | 2.18 / 2.41 |
| 2 | 24 | 4.53 | 4.51–4.55 | 2.267 | 4.37 | 2.06 / 3.03 |
| 4 | 24 | 9.16 | 9.14–9.18 | 2.290 | 8.64 | 3.31 / 4.03 |
| 6 | 24 | 13.89 | 13.84–13.94 | 2.315 | 12.80 | 4.20 / 5.49 |
| 8 | 32 | 18.60 | 18.57–18.62 | 2.325 | 16.86 | 4.55 / 6.23 |
| 11 | 44 | 23.28 | 22.98–23.58 | 2.116 | 20.86 | 5.47 / 7.64 |
| 15 | 30 | 24.60 | 24.58–24.63 | 1.640 | 22.12 | 6.05 / 10.11 |
| 22 | 44 | 33.87 | 33.24–34.50 | 1.539 | 29.26 | 9.71 / 14.51 |
| 32 | 64 | 38.31 | 38.14–38.48 | 1.197 | 32.48 | 13.44 / 21.90 |
| 48 | 96 | 45.33 | 44.66–46.01 | 0.944 | 37.68 | 18.85 / 31.55 |
| 64 | 128 | 53.60 | 53.45–53.74 | 0.837 | 42.41 | 25.10 / 46.41 |
| 88 | 176 | 60.29 | 58.86–61.71 | 0.685 | 46.87 | 34.61 / 64.75 |
| 96 | 192 | 46.85 | 46.43–47.27 | 0.488 | 39.79 | 38.94 / 71.31 |
| 128 | 256 | 50.10 | 49.84–50.36 | 0.391 | 41.61 | 55.11 / 108.73 |
| 176 | 352 | 57.72 | 57.49–57.94 | 0.328 | 45.24 | 76.83 / 165.34 |

## Metric definitions and interpretation

For each cohort, the shared decode interval starts at the latest first-token event and ends at the earliest last-token event. Count emitted tokens in the interval `(start, end]`. Each phase's aggregate decode rate is the sum of those cohort token counts divided by the sum of their interval durations. Whole-phase throughput uses all completion tokens divided by the full phase duration, including admission, capacity backoff, prefill and drain.

Each submitted `decodeTps` is the arithmetic mean of `steady_aggregate_tok_s` for `mixed_a_cNNN` and `mixed_b_cNNN`. `ttftMs` is 1,000 times the median of all `request_metrics[].ttft_s` from those two phases. The p95 uses linear interpolation at position `(N - 1) * 0.95` in the sorted request latencies. TTFT and completion counts include reasoning and structural model tokens as well as answer text. Prompt throughput was not separately measured, so `promptTps` is omitted.

The lone-stream path uses learned speculative decoding. Its first and repeated passes measured **5.676968** and **10.243011 tokens/s**, respectively; all twelve paired outputs match through the 128-token cap. Phrase learning remained active, the prompt templates repeated, and capture writes changed between passes. This mean characterizes that stateful service, and does not establish an unseen-prompt baseline or a kernel speedup. Capture writes were enabled on the ascending 1–15-stream phases and disabled thereafter. Other generation during an operator pause could also contribute phrase history, but was excluded from measured phase counters.

The 88-stream point was an exploratory refinement, with eight rows in each of eleven pipeline groups and 79 distinct prompts among 88 requests per phase. It is the highest paired mean on the tested grid of 1–176 streams. The two observed phase rates, 58.860866 and 61.711884 tokens/s, are a range, not a confidence interval. Its pooled median TTFT is 34.61 seconds and its mean contribution per stream is 0.685 tokens/s.

The survey used a **128-token output cap**, below this site's recommended 256 tokens. Interrupted collection and stress attempts were excluded: these are completed-run throughput figures, not reliability estimates. A 256-stream attempt disconnected during admission and collection was capped at 176. See the original [report](https://github.com/labscommunity/cascadia/blob/3189a189fe3428f5a6315a7eb67b13148ec314e2/autolab/experiments/046_final_performance/report.md) for exclusions, capture changes and pause history. Short correctness gates and repeated-output agreement do not establish general model quality.

Older autolab summaries report roughly 64–70 tokens/s using sums of individual request rates over different intervals. The submitted numbers use the final common-interval metric throughout. The separate explanation-family maximum of 15.04 tokens/s is a single request and is not substituted for the mixed-workload serial result.

## Public evidence and reconstruction

All submitted evidence links point to the public Cascadia repository at the frozen commit:

- [Sanitized phase measurements](https://github.com/labscommunity/cascadia/blob/3189a189fe3428f5a6315a7eb67b13148ec314e2/autolab/experiments/046_final_performance/measurements.json): the phase/cohort counts, timing and request metrics used here. SHA-256: `93713ac0da2d9514c914911fd730cba53854a2992b065933f689e0261fa3e960`.
- [Collector and metric implementation](https://github.com/labscommunity/cascadia/blob/3189a189fe3428f5a6315a7eb67b13148ec314e2/autolab/bench/performance_sweep.py).
- [Single-stream comparison and output hashes](https://github.com/labscommunity/cascadia/blob/3189a189fe3428f5a6315a7eb67b13148ec314e2/autolab/experiments/046_final_performance/single-stream-comparison.json).
- [Study report, charts and exclusions](https://github.com/labscommunity/cascadia/blob/3189a189fe3428f5a6315a7eb67b13148ec314e2/autolab/experiments/046_final_performance/report.md).

Select only phase names starting with `mixed_`, group by `streams`, and apply the definitions above to reproduce the CSV and result files. For every phase, completion counts equal 128 times request count; dividing by `end - start` reproduces whole-phase throughput. Summing `cohorts[].overlap_tokens` and dividing by summed `cohorts[].overlap_s` reproduces the shared decode rate. The public JSON was fetched anonymously and matched the retained local source byte for byte.

## Submission dependencies

The result files reference **[Panther Lake Lab, rig 8](https://intelinside.ai/rigs/8)**, owned by `t8`, with eleven Core Ultra X7 358H CPUs and eleven Arc B390 iGPUs, and **[Cascadia Inkling Autolab, custom runtime 1](https://intelinside.ai/runtimes/cascadia/custom/1)**. Both registrations are complete and the result files use their numeric IDs.

Before these results can pass hosted ingestion:

1. Merge and deploy [catalog PR #51](https://github.com/labscommunity/intelinside/pull/51), which adds Inkling and its generated model/INT4 migration. The ingestion workflow validates against the catalog on `main` and the hosted database.
2. Rerun result ingestion validation. Merge the result PR only after it accepts the linked account, rig ownership, model/quant board and custom runtime.

The experimental build is submitted as a custom runtime. Whole-fleet results omit `component` because the run uses both CPU and iGPU across all eleven nodes.
