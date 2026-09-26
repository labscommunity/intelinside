import type { HardwareItem, HardwareType, Model, Quant, Runtime } from '@/lib/api/types'

// The catalog: every hardware part, model, quantization, and runtime the site knows about. This file is the source
// of truth. `npm run catalog:seed` turns it into the SQL that seeds the database, so a pull request here is
// how a part or model gets onto the site. See catalog/README.md.

export const RUNTIMES: Runtime[] = [
  { id: 'cascadia', name: 'Cascadia', logoUrl: '/logos/runtimes/cascadia.svg', repoUrl: 'https://github.com/labscommunity/cascadia', color: '#e89960' },
  { id: 'pytorch', name: 'PyTorch', logoUrl: '', repoUrl: 'https://github.com/pytorch/pytorch', color: '#df8db5' },
  { id: 'vllm', name: 'vLLM', logoUrl: '', repoUrl: 'https://github.com/vllm-project/vllm', color: '#dac46d' },
  { id: 'llamacpp', name: 'llama.cpp', logoUrl: '', repoUrl: 'https://github.com/ggml-org/llama.cpp', color: '#9ec773' },
  { id: 'ollama', name: 'Ollama', logoUrl: '', repoUrl: 'https://github.com/ollama/ollama', color: '#b4b7bf' },
  { id: 'openvino-genai', name: 'OpenVINO GenAI', logoUrl: '', repoUrl: 'https://github.com/openvinotoolkit/openvino.genai', color: '#6ab8e4' },
  { id: 'ipex-llm', name: 'IPEX-LLM', logoUrl: '', repoUrl: 'https://github.com/intel/ipex-llm', color: '#64c6ad' },
]

export const QUANTS: Quant[] = [
  { id: 'int4', label: 'INT4', bits: 4, format: 'OpenVINO and IPEX weight-only, used by Cascadia and Intel runtimes' },
  { id: 'int8', label: 'INT8', bits: 8, format: 'OpenVINO / IPEX weight-only' },
  { id: 'fp8', label: 'FP8', bits: 8, format: 'FP8 e4m3' },
  { id: 'fp16', label: 'FP16', bits: 16, format: 'Half precision, the unquantized weights' },
  { id: 'bf16', label: 'BF16', bits: 16, format: 'Brain float' },
  { id: 'q2_0', label: 'Q2_0', bits: 2, format: 'GGUF' },
  { id: 'q4_k_m', label: 'Q4_K_M', bits: 4, format: 'GGUF, used by llama.cpp and Ollama' },
  { id: 'q4_k_l', label: 'Q4_K_L', bits: 4, format: 'GGUF' },
  { id: 'q4_k_xl', label: 'Q4_K_XL', bits: 4, format: 'GGUF, Unsloth Dynamic Q4_K_XL' },
  { id: 'q4_0', label: 'Q4_0', bits: 4, format: 'GGUF' },
  { id: 'q5_k_m', label: 'Q5_K_M', bits: 5, format: 'GGUF' },
  { id: 'q6_k', label: 'Q6_K', bits: 6, format: 'GGUF' },
  { id: 'q8_0', label: 'Q8_0', bits: 8, format: 'GGUF, used by llama.cpp and Ollama' },
  { id: 'awq-4bit', label: 'AWQ 4-bit', bits: 4, format: 'AWQ' },
  { id: 'gptq-4bit', label: 'GPTQ 4-bit', bits: 4, format: 'GPTQ' },
  { id: 'nf4', label: 'NF4', bits: 4, format: 'bitsandbytes' },
  { id: 'mxfp4', label: 'MXFP4', bits: 4, format: 'Microscaling FP4' },
]

export const MODELS: Model[] = [
  {
    id: 'gemma-3-12b', name: 'Gemma 3 12B IT', family: 'Gemma 3', brand: 'Gemma', params: '12B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/google/gemma-3-12b-it', logoUrl: '/logos/models/gemma.svg', brandColor: '#6dc799', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'gemma-4-12b', name: 'Gemma 4 12B IT', family: 'Gemma 4', brand: 'Gemma', params: '12B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/google/gemma-4-12B-it', logoUrl: '/logos/models/gemma.svg', brandColor: '#6dc799', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'gemma-4-26b-a4b', name: 'Gemma 4 26B A4B IT', family: 'Gemma 4', brand: 'Gemma', params: '26B', architecture: 'moe', activeParams: '4B',
    sourceUrl: 'https://huggingface.co/google/gemma-4-26B-A4B-it', logoUrl: '/logos/models/gemma.svg', brandColor: '#6dc799', quants: ['int4', 'q4_0', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'glm-5-3-flash', name: 'GLM-5.3-Flash', family: 'GLM-5.3', brand: 'GLM', params: '320B', architecture: 'moe', activeParams: '18B',
    sourceUrl: 'https://huggingface.co/zai-org/GLM-5.3-Flash', logoUrl: '/logos/models/glm.svg', brandColor: '#7fa9d9', quants: ['int4', 'q4_k_m'],
  },
  {
    id: 'gpt-oss-20b', name: 'gpt-oss-20b', family: 'gpt-oss', brand: 'gpt-oss', params: '21B', architecture: 'moe', activeParams: '3.6B',
    sourceUrl: 'https://huggingface.co/openai/gpt-oss-20b', logoUrl: '/logos/models/gpt-oss.svg', brandColor: '#a3b8cf', quants: ['mxfp4', 'int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'granite-4-2-30b', name: 'Granite 4.2 30B', family: 'Granite 4.2', brand: 'Granite', params: '30B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/ibm-granite/granite-4.2-30b', logoUrl: '/logos/models/granite.svg', brandColor: '#8fa8d8', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'granite-4-2-8b', name: 'Granite 4.2 8B', family: 'Granite 4.2', brand: 'Granite', params: '8B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/ibm-granite/granite-4.2-8b', logoUrl: '/logos/models/granite.svg', brandColor: '#8fa8d8', quants: ['int4', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'lfm2-5-2-6b', name: 'LFM2.5-2.6B', family: 'LFM2.5', brand: 'LFM', params: '2.6B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/LiquidAI/LFM2.5-2.6B', logoUrl: '/logos/models/liquid.svg', brandColor: '#6fc3d6', quants: ['int4', 'int8', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'lfm2-5-8b-a1b', name: 'LFM2.5-8B-A1B', family: 'LFM2.5', brand: 'LFM', params: '8B', architecture: 'moe', activeParams: '1B',
    sourceUrl: 'https://huggingface.co/LiquidAI/LFM2.5-8B-A1B', logoUrl: '/logos/models/liquid.svg', brandColor: '#6fc3d6', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'llama-3-1-8b', name: 'Llama 3.1 8B Instruct', family: 'Llama 3.1', brand: 'Llama', params: '8B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct', logoUrl: '/logos/models/llama.svg', brandColor: '#73b0ee', quants: ['int4', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'minicpm5-2b', name: 'MiniCPM5-2B', family: 'MiniCPM5', brand: 'MiniCPM', params: '2.5B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/openbmb/MiniCPM5-2B', logoUrl: '/logos/models/minicpm.svg', brandColor: '#e5a3c2', quants: ['int4', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'mistral-small-3-2-24b', name: 'Mistral Small 3.2 24B Instruct', family: 'Mistral Small 3.2', brand: 'Mistral', params: '24B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506', logoUrl: '/logos/models/mistral.svg', brandColor: '#eba36d', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'nemotron-3-5-lightning-30b-a3b', name: 'Nemotron 3.5 Lightning 30B A3B', family: 'Nemotron 3.5', brand: 'Nemotron', params: '30B', architecture: 'moe', activeParams: '3B',
    sourceUrl: 'https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16', logoUrl: '/logos/models/nemotron.svg', brandColor: '#8fc25c', quants: ['gptq-4bit', 'q4_k_m', 'q8_0', 'bf16'],
  },
  {
    id: 'muse-glimmer-30b', name: 'Muse Glimmer 30B', family: 'Muse', brand: 'Muse', params: '30B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/facebook/Muse-Glimmer-30B', logoUrl: '/logos/models/llama.svg', brandColor: '#73b0ee', quants: ['q4_k_xl'],
  },
  {
    id: 'qwen3-30b-a3b', name: 'Qwen3-30B-A3B', family: 'Qwen3', brand: 'Qwen', params: '30B', architecture: 'moe', activeParams: '3B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-30B-A3B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-4b-instruct-2507', name: 'Qwen3-4B-Instruct-2507', family: 'Qwen3', brand: 'Qwen', params: '4B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'int8', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'qwen3-8b', name: 'Qwen3-8B', family: 'Qwen3', brand: 'Qwen', params: '8B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-8B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'qwen3-coder-next', name: 'Qwen3-Coder-Next', family: 'Qwen3-Next', brand: 'Qwen', params: '80B', architecture: 'moe', activeParams: '3B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-Coder-Next', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-next-80b-a3b', name: 'Qwen3-Next-80B-A3B-Instruct', family: 'Qwen3-Next', brand: 'Qwen', params: '80B', architecture: 'moe', activeParams: '3B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-5-0-8b', name: 'Qwen3.5-0.8B', family: 'Qwen3.5', brand: 'Qwen', params: '0.8B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.5-0.8B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'qwen3-5-122b-a10b', name: 'Qwen3.5-122B-A10B', family: 'Qwen3.5', brand: 'Qwen', params: '122B', architecture: 'moe', activeParams: '10B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.5-122B-A10B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['gptq-4bit', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-5-27b', name: 'Qwen3.5-27B', family: 'Qwen3.5', brand: 'Qwen', params: '27B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.5-27B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'awq-4bit', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-5-2b', name: 'Qwen3.5-2B', family: 'Qwen3.5', brand: 'Qwen', params: '2B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.5-2B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'qwen3-5-35b-a3b', name: 'Qwen3.5-35B-A3B', family: 'Qwen3.5', brand: 'Qwen', params: '35B', architecture: 'moe', activeParams: '3B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.5-35B-A3B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'gptq-4bit', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-5-397b-a17b', name: 'Qwen3.5-397B-A17B', family: 'Qwen3.5', brand: 'Qwen', params: '397B', architecture: 'moe', activeParams: '17B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.5-397B-A17B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['gptq-4bit', 'q4_k_m'],
  },
  {
    id: 'qwen3-5-4b', name: 'Qwen3.5-4B', family: 'Qwen3.5', brand: 'Qwen', params: '4B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.5-4B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'awq-4bit', 'q4_k_m', 'q8_0', 'fp16'],
  },
  {
    id: 'qwen3-5-9b', name: 'Qwen3.5-9B', family: 'Qwen3.5', brand: 'Qwen', params: '9B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.5-9B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'awq-4bit', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-6-27b', name: 'Qwen3.6-27B', family: 'Qwen3.6', brand: 'Qwen', params: '27B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.6-27B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'awq-4bit', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-6-35b-a3b', name: 'Qwen3.6-35B-A3B', family: 'Qwen3.6', brand: 'Qwen', params: '35B', architecture: 'moe', activeParams: '3B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.6-35B-A3B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'q4_k_m', 'q8_0'],
  },
  {
    id: 'qwen3-8-2-4t-a95b', name: 'Qwen3.8-2.4T-A95B', family: 'Qwen3.8', brand: 'Qwen', params: '2.4T', architecture: 'moe', activeParams: '95B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['fp8', 'q4_k_m'],
  },
  {
    id: 'qwen3-8-27b', name: 'Qwen3.8-27B', family: 'Qwen3.8', brand: 'Qwen', params: '27B', architecture: 'dense',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.8-27B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['int4', 'int8', 'q4_k_m', 'q4_k_l', 'q8_0'],
  },
  {
    id: 'qwen3-8-flash-next', name: 'Qwen3.8-Flash-Next', family: 'Qwen3.8', brand: 'Qwen', params: '125B', architecture: 'moe', activeParams: '6B',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.8-Flash-Next', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb', quants: ['fp8', 'q2_0', 'q4_k_m', 'q8_0'],
  },
]

/** One-line explanation of a quant for tooltips. */
export function quantHint(id: string): string {
  const q = QUANT_BY_ID[id]
  return q ? `${q.bits}-bit · ${q.format}` : id
}

export const HARDWARE_TYPE_LABEL: Record<HardwareType, string> = {
  cpu: 'CPU', gpu: 'GPU', igpu: 'Integrated GPU', npu: 'NPU', ram: 'Memory',
}
export const HARDWARE_TYPES: HardwareType[] = ['cpu', 'gpu', 'igpu', 'npu', 'ram']

const hw = (
  id: string, type: HardwareType, vendor: string, name: string, specs: Record<string, string | number>,
  releaseDate?: string, series?: string, integrated?: string[],
): HardwareItem => ({ id, type, vendor, name, series, specs, releaseDate, source: 'seeded', ...(integrated ? { integrated } : {}) })

// A CPU's `integrated` list names the iGPU and NPU on its package. They are catalog items in their own right, with
// their own pages and board rows, so a run on the CPU cores, the iGPU, and the NPU of one chip ranks as three parts.

export const HARDWARE: HardwareItem[] = [
  // Intel CPUs
  hw('intel-core-ultra-9-285k', 'cpu', 'Intel', 'Core Ultra 9 285K', { cores: 24, threads: 24, boostGhz: 5.7, tdpW: 125, platform: 'Arrow Lake-S' }, '2024-10-24', 'Core Ultra 200S', ['intel-graphics-arrow-lake-s', 'intel-ai-boost-arrow-lake']),
  hw('intel-core-ultra-7-265k', 'cpu', 'Intel', 'Core Ultra 7 265K', { cores: 20, threads: 20, boostGhz: 5.5, tdpW: 125, platform: 'Arrow Lake-S' }, '2024-10-24', 'Core Ultra 200S', ['intel-graphics-arrow-lake-s', 'intel-ai-boost-arrow-lake']),
  hw('intel-core-ultra-5-245k', 'cpu', 'Intel', 'Core Ultra 5 245K', { cores: 14, threads: 14, boostGhz: 5.2, tdpW: 125, platform: 'Arrow Lake-S' }, '2024-10-24', 'Core Ultra 200S', ['intel-graphics-arrow-lake-s', 'intel-ai-boost-arrow-lake']),
  hw('intel-core-ultra-9-288v', 'cpu', 'Intel', 'Core Ultra 9 288V', { cores: 8, threads: 8, boostGhz: 5.1, tdpW: 30, platform: 'Lunar Lake' }, '2024-09-24', 'Core Ultra 200V', ['intel-arc-140v', 'intel-ai-boost-npu-4']),
  hw('intel-core-ultra-7-258v', 'cpu', 'Intel', 'Core Ultra 7 258V', { cores: 8, threads: 8, boostGhz: 4.8, tdpW: 17, platform: 'Lunar Lake' }, '2024-09-24', 'Core Ultra 200V', ['intel-arc-140v', 'intel-ai-boost-npu-4']),
  hw('intel-core-ultra-7-155h', 'cpu', 'Intel', 'Core Ultra 7 155H', { cores: 16, threads: 22, boostGhz: 4.8, tdpW: 28, platform: 'Meteor Lake' }, '2023-12-14', 'Core Ultra 100H', ['intel-arc-graphics-meteor-lake', 'intel-ai-boost-npu-3']),
  hw('intel-core-ultra-x7-358h', 'cpu', 'Intel', 'Core Ultra X7 358H', { cores: 16, threads: 16, boostGhz: 4.8, tdpW: 25, platform: 'Panther Lake' }, '2026-01-05', 'Core Ultra 300', ['intel-arc-b390', 'intel-ai-boost-npu-5']),
  hw('intel-core-i9-14900k', 'cpu', 'Intel', 'Core i9-14900K', { cores: 24, threads: 32, boostGhz: 6.0, tdpW: 125, platform: 'Raptor Lake Refresh' }, '2023-10-17', 'Core 14th Gen', ['intel-uhd-770']),
  hw('intel-core-i7-14700k', 'cpu', 'Intel', 'Core i7-14700K', { cores: 20, threads: 28, boostGhz: 5.6, tdpW: 125, platform: 'Raptor Lake Refresh' }, '2023-10-17', 'Core 14th Gen', ['intel-uhd-770']),
  hw('intel-xeon-w7-3465x', 'cpu', 'Intel', 'Xeon w7-3465X', { cores: 28, threads: 56, boostGhz: 4.8, tdpW: 300, platform: 'Sapphire Rapids' }, '2023-02-15', 'Xeon W-3400'),
  hw('intel-xeon-6-6960p', 'cpu', 'Intel', 'Xeon 6 6960P', { cores: 72, threads: 144, boostGhz: 3.9, tdpW: 500, platform: 'Granite Rapids' }, '2024-09-24', 'Xeon 6'),
  // Other CPUs
  hw('amd-ryzen-9-9950x', 'cpu', 'AMD', 'Ryzen 9 9950X', { cores: 16, threads: 32, boostGhz: 5.7, tdpW: 170, platform: 'Zen 5' }, '2024-08-15', 'Ryzen 9000'),
  hw('amd-ryzen-7-9800x3d', 'cpu', 'AMD', 'Ryzen 7 9800X3D', { cores: 8, threads: 16, boostGhz: 5.2, tdpW: 120, platform: 'Zen 5' }, '2024-11-07', 'Ryzen 9000'),
  hw('apple-m4-max', 'cpu', 'Apple', 'M4 Max (16-core)', { cores: 16, threads: 16, boostGhz: 4.5, tdpW: 90, platform: 'Apple silicon' }, '2024-10-30', 'M4', ['apple-m4-max-gpu-40c']),
  // Intel discrete GPUs
  hw('intel-arc-pro-b70', 'gpu', 'Intel', 'Arc Pro B70', { vramGb: 32, memoryType: 'GDDR6', xeCores: 32, tdpW: 240 }, '2026-03-10', 'Arc Pro B'),
  hw('intel-arc-pro-b60', 'gpu', 'Intel', 'Arc Pro B60', { vramGb: 24, memoryType: 'GDDR6', xeCores: 20, tdpW: 200 }, '2025-05-19', 'Arc Pro B'),
  hw('intel-arc-pro-b50', 'gpu', 'Intel', 'Arc Pro B50', { vramGb: 16, memoryType: 'GDDR6', xeCores: 16, tdpW: 70 }, '2025-05-19', 'Arc Pro B'),
  hw('intel-arc-b580', 'gpu', 'Intel', 'Arc B580', { vramGb: 12, memoryType: 'GDDR6', xeCores: 20, tdpW: 190 }, '2024-12-13', 'Arc B'),
  hw('intel-arc-b570', 'gpu', 'Intel', 'Arc B570', { vramGb: 10, memoryType: 'GDDR6', xeCores: 18, tdpW: 150 }, '2025-01-16', 'Arc B'),
  hw('intel-arc-a770-16gb', 'gpu', 'Intel', 'Arc A770 16GB', { vramGb: 16, memoryType: 'GDDR6', xeCores: 32, tdpW: 225 }, '2022-10-12', 'Arc A'),
  hw('intel-arc-a750', 'gpu', 'Intel', 'Arc A750', { vramGb: 8, memoryType: 'GDDR6', xeCores: 28, tdpW: 225 }, '2022-10-12', 'Arc A'),
  hw('intel-gaudi-3', 'gpu', 'Intel', 'Gaudi 3', { vramGb: 128, memoryType: 'HBM2e', tdpW: 900 }, '2024-04-09', 'Gaudi'),
  // Other GPUs
  hw('nvidia-geforce-rtx-5090', 'gpu', 'NVIDIA', 'GeForce RTX 5090', { vramGb: 32, memoryType: 'GDDR7', tdpW: 575 }, '2025-01-30', 'GeForce 50'),
  hw('nvidia-geforce-rtx-4090', 'gpu', 'NVIDIA', 'GeForce RTX 4090', { vramGb: 24, memoryType: 'GDDR6X', tdpW: 450 }, '2022-10-12', 'GeForce 40'),
  hw('nvidia-geforce-rtx-3090', 'gpu', 'NVIDIA', 'GeForce RTX 3090', { vramGb: 24, memoryType: 'GDDR6X', tdpW: 350 }, '2020-09-24', 'GeForce 30'),
  hw('nvidia-rtx-pro-6000-blackwell', 'gpu', 'NVIDIA', 'RTX PRO 6000 Blackwell', { vramGb: 96, memoryType: 'GDDR7', tdpW: 600 }, '2025-03-18', 'RTX PRO'),
  hw('amd-radeon-rx-7900-xtx', 'gpu', 'AMD', 'Radeon RX 7900 XTX', { vramGb: 24, memoryType: 'GDDR6', tdpW: 355 }, '2022-12-13', 'Radeon 7000'),
  // Integrated GPUs
  hw('intel-graphics-arrow-lake-s', 'igpu', 'Intel', 'Intel Graphics (Arrow Lake-S)', { xeCores: 4, platform: 'Arrow Lake-S', architecture: 'Xe-LPG' }, '2024-10-24', 'Intel Graphics'),
  hw('intel-arc-140v', 'igpu', 'Intel', 'Arc 140V', { xeCores: 8, platform: 'Lunar Lake', architecture: 'Xe2' }, '2024-09-24', 'Arc'),
  hw('intel-arc-140t', 'igpu', 'Intel', 'Arc 140T', { xeCores: 8, platform: 'Arrow Lake-H', architecture: 'Xe' }, '2025-01-06', 'Arc'),
  hw('intel-arc-graphics-meteor-lake', 'igpu', 'Intel', 'Arc Graphics (Meteor Lake)', { xeCores: 8, platform: 'Meteor Lake', architecture: 'Xe-LPG' }, '2023-12-14', 'Arc'),
  hw('intel-arc-b390', 'igpu', 'Intel', 'Arc B390', { xeCores: 12, platform: 'Panther Lake', architecture: 'Xe3' }, '2026-01-05', 'Arc B'),
  hw('intel-uhd-770', 'igpu', 'Intel', 'UHD Graphics 770', { euCount: 32, platform: 'Alder / Raptor Lake', architecture: 'Xe-LP' }, '2021-11-04', 'UHD'),
  hw('apple-m4-max-gpu-40c', 'igpu', 'Apple', 'M4 Max GPU (40-core)', { cores: 40, platform: 'Apple silicon' }, '2024-10-30', 'M4'),
  // NPUs
  hw('intel-ai-boost-npu-3', 'npu', 'Intel', 'AI Boost NPU (Meteor Lake)', { tops: 11, platform: 'Meteor Lake' }, '2023-12-14', 'AI Boost'),
  hw('intel-ai-boost-npu-4', 'npu', 'Intel', 'AI Boost NPU 4 (Lunar Lake)', { tops: 48, platform: 'Lunar Lake' }, '2024-09-24', 'AI Boost'),
  hw('intel-ai-boost-npu-5', 'npu', 'Intel', 'AI Boost NPU 5 (Panther Lake)', { tops: 50, platform: 'Panther Lake' }, '2026-01-05', 'AI Boost'),
  hw('intel-ai-boost-arrow-lake', 'npu', 'Intel', 'AI Boost NPU (Arrow Lake)', { tops: 13, platform: 'Arrow Lake' }, '2024-10-24', 'AI Boost'),
  // Memory (one item = one module; the rig quantity gives total capacity)
  hw('ddr5-5600-32gb', 'ram', 'Generic', 'DDR5-5600 32 GB', { type: 'DDR5', speedMts: 5600, capacityGb: 32, formFactor: 'UDIMM' }),
  hw('ddr5-6000-32gb', 'ram', 'Generic', 'DDR5-6000 32 GB', { type: 'DDR5', speedMts: 6000, capacityGb: 32, formFactor: 'UDIMM' }),
  hw('ddr5-6400-48gb', 'ram', 'Generic', 'DDR5-6400 48 GB', { type: 'DDR5', speedMts: 6400, capacityGb: 48, formFactor: 'UDIMM' }),
  hw('ddr5-4800-64gb-ecc', 'ram', 'Generic', 'DDR5-4800 64 GB ECC RDIMM', { type: 'DDR5', speedMts: 4800, capacityGb: 64, formFactor: 'RDIMM' }),
  hw('ddr5-5600-16gb-sodimm', 'ram', 'Generic', 'DDR5-5600 16 GB SO-DIMM', { type: 'DDR5', speedMts: 5600, capacityGb: 16, formFactor: 'SO-DIMM' }),
  hw('lpddr5x-8533-16gb', 'ram', 'Generic', 'LPDDR5X-8533 16 GB (on package)', { type: 'LPDDR5X', speedMts: 8533, capacityGb: 16, formFactor: 'On package' }),
  hw('lpddr5x-8533-128gb-unified', 'ram', 'Apple', 'Unified memory 128 GB', { type: 'LPDDR5X', speedMts: 8533, capacityGb: 128, formFactor: 'On package' }),
  hw('ddr4-3200-32gb', 'ram', 'Generic', 'DDR4-3200 32 GB', { type: 'DDR4', speedMts: 3200, capacityGb: 32, formFactor: 'UDIMM' }),
]

export const HARDWARE_BY_ID: Record<string, HardwareItem> = Object.fromEntries(HARDWARE.map((h) => [h.id, h]))
/** Hardware currently exposed in browsing and rig-building UIs. */
export const VISIBLE_HARDWARE = HARDWARE.filter((h) => h.vendor === 'Intel' || h.vendor === 'Generic')
export const RUNTIME_BY_ID: Record<string, Runtime> = Object.fromEntries(RUNTIMES.map((r) => [r.id, r]))
export const MODEL_BY_ID: Record<string, Model> = Object.fromEntries(MODELS.map((m) => [m.id, m]))
export const QUANT_BY_ID: Record<string, Quant> = Object.fromEntries(QUANTS.map((q) => [q.id, q]))
export const VENDORS = Array.from(new Set(VISIBLE_HARDWARE.map((h) => h.vendor))).filter((v) => v !== 'Generic')
