# Model logos

These are static image assets used by `src/components/ModelLogo.tsx`. Set each model's
`logoUrl` in `src/catalog/index.ts` to the corresponding file under `/logos/models/`.

Most marks come from [LobeHub Icons](https://github.com/lobehub/lobe-icons), via
the installed `@lobehub/icons-static-svg` package (version 1.94.0 for these additions).
The package declares an MIT license; the logos remain their owners' trademarks.

| Local file | Package file under `icons/` | Adaptation |
| --- | --- | --- |
| gemma.svg | gemma-color.svg | Existing color mark |
| llama.svg | meta-color.svg | Existing color mark |
| qwen.svg | qwen-color.svg | Existing color mark |
| glm.svg | zai.svg | `currentColor` replaced with `#7fa9d9` |
| gpt-oss.svg | openai.svg | `currentColor` replaced with `#a3b8cf` |
| granite.svg | ibm.svg | `currentColor` replaced with `#8fa8d8` |
| liquid.svg | liquid.svg | `currentColor` replaced with `#6fc3d6` |
| mistral.svg | mistral-color.svg | Original color mark |
| nemotron.svg | nvidia-color.svg | Original color mark |

`llama.svg` is Meta's mark, shared by the Llama and Muse model families.

MiniCPM is not in that package. `minicpm.svg` uses the symbol (first path) from
[ModelBest's official MiniCPM SVG](https://www.modelbest.cn/modelbest/minicpm-en.aZf632Pf.svg),
linked by [its website](https://www.modelbest.cn/en/) and retrieved on 2026-09-17.
The wordmark is omitted, the viewBox frames the symbol in a square, and its fill
is changed from `#333333` to the catalog's `#e5a3c2`. The geometry is unchanged.

To add another family, copy the appropriate mark from
`node_modules/@lobehub/icons-static-svg/icons/`, prefer the color variant when
available, and record the source here. For monochrome marks, replace
`currentColor` with an explicit color that works on the site's tile backgrounds:
SVGs loaded through `<img>` do not inherit the page's text color.

`ornith.webp` is the unmodified organization avatar from
[Ornith's Hugging Face profile](https://huggingface.co/ornith-ai), retrieved on 2026-09-29.
[Original asset](https://cdn-avatars.huggingface.co/v1/production/uploads/68661bce022667cf9c7534fb/dwzGCqj9B7NGaJRO-NjjP.png).
The source URL ends in `.png`, but the downloaded asset is a 200 × 200 WebP;
the local extension matches its actual format. The logo remains its owner's trademark.

`poolside.png` is the unmodified 200 × 200 organization avatar from
[Poolside’s official Hugging Face page](https://huggingface.co/poolside),
retrieved on 2026-09-29 from [Hugging Face’s avatar CDN](https://cdn-avatars.huggingface.co/v1/production/uploads/699484cbe85a4b61cbc5ee0f/GpYWuz-CovEFgbPOW21dZ.png).
It is Poolside’s trademark and is not covered by this repository’s MIT license.

`thinking-machines.webp` is the unmodified 200 × 200 organization avatar from
[Thinking Machines Lab’s Hugging Face profile](https://huggingface.co/thinkingmachines),
retrieved on 2026-09-29 from [the original asset](https://cdn-avatars.huggingface.co/v1/production/uploads/680a76de1b8d08640089fab0/r60-JyW_pv4llgjEyDYj9.png).
The source URL ends in `.png`, but the downloaded asset is WebP.
It is used for Inkling, with its original black wordmark and white background.

`prismml.jpg` is the unmodified 400 × 400 profile avatar from
[PrismML’s X account](https://x.com/PrismML), retrieved on 2026-09-29 from
[X’s image CDN](https://pbs.twimg.com/profile_images/2025105666692812800/QQOxLQPq.jpg).
The asset URL was located through [Thread Reader’s profile mirror](https://threadreaderapp.com/user/PrismML).
Both Bonsai models use this avatar: its original light background provides contrast
for the dark mark without recoloring the logo.

These logos remain their owners’ trademarks and are not covered by this repository’s MIT license.
