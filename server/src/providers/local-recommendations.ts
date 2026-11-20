import {
  LOCAL_MODEL_RAM_RESERVE_GIB,
  type LocalModelHardware,
  type LocalModelRecommendations,
  type LocalModelSuggestion,
  type Mode,
} from "../../../shared/protocol.ts";

interface CatalogModel {
  name: string;
  ollamaId: string;
  gguf: string;
  quant: string;
  weightsGiB: number;
  cacheMiBPerK: number;
  maxContext: number;
  supportsTools: boolean;
  code: boolean;
}

// Preferred order for GPU use. Each row describes a concrete quantization and budgets
// for the larger of the linked GGUF and the Ollama bundle (including auxiliary weights).
// See docs/LOCAL-MODELS.md for the sources and estimation assumptions.
const CATALOG: CatalogModel[] = [
  { name: "Qwen3.8 27B", ollamaId: "qwen3.8:27b-q4_K_M", gguf: "ggml-org/Qwen3.8-27B-GGUF", quant: "Q4_K_M", weightsGiB: 17.25, cacheMiBPerK: 128, maxContext: 65_536, supportsTools: true, code: true },
  { name: "Gemma 4 12B", ollamaId: "gemma4:12b", gguf: "ggml-org/gemma-4-12B-it-GGUF", quant: "Q4_0", weightsGiB: 7.75, cacheMiBPerK: 192, maxContext: 65_536, supportsTools: true, code: true },
  { name: "Qwen3.5 9B", ollamaId: "qwen3.5:9b", gguf: "unsloth/Qwen3.5-9B-GGUF", quant: "Q4_K_M", weightsGiB: 6.5, cacheMiBPerK: 96, maxContext: 65_536, supportsTools: true, code: true },
  { name: "Qwen3.5 4B", ollamaId: "qwen3.5:4b", gguf: "unsloth/Qwen3.5-4B-GGUF", quant: "Q4_K_M", weightsGiB: 3.25, cacheMiBPerK: 96, maxContext: 32_768, supportsTools: true, code: true },
  { name: "Qwen3.5 2B", ollamaId: "qwen3.5:2b", gguf: "unsloth/Qwen3.5-2B-GGUF", quant: "Q8_0", weightsGiB: 2.75, cacheMiBPerK: 64, maxContext: 32_768, supportsTools: true, code: false },
];

const quarterUp = (value: number) => Math.ceil(value * 4) / 4;

export function recommendLocalModels(hardware: LocalModelHardware, mode: Mode, contextTokens: number): LocalModelRecommendations {
  const gpu: LocalModelSuggestion[] = [];
  const ram: LocalModelSuggestion[] = [];
  const ramBudget = hardware.availableRamGiB - LOCAL_MODEL_RAM_RESERVE_GIB;
  for (const model of CATALOG) {
    if (contextTokens > model.maxContext || (mode === "code" && !model.code)) continue;
    const contextGiB = (contextTokens / 1024) * (model.cacheMiBPerK / 1024);
    const runtimeGiB = Math.max(1.25, model.weightsGiB * 0.12);
    const useGiB = quarterUp(model.weightsGiB + contextGiB + runtimeGiB);
    const hostGiB = quarterUp(0.75 + model.weightsGiB * 0.06);
    const gpuGiB = useGiB + 0.5;
    const details = {
      name: model.name,
      ollamaId: model.ollamaId,
      ggufUrl: `https://huggingface.co/${model.gguf}`,
      ggufQuantization: model.quant,
      supportsTools: model.supportsTools,
    };
    if (ramBudget >= hostGiB && (hardware.freeGpuGiB ?? 0) >= gpuGiB) {
      gpu.push({ ...details, placement: "gpu", estimatedRamGiB: hostGiB, estimatedGpuGiB: gpuGiB });
    } else if (ramBudget >= useGiB) {
      ram.push({ ...details, placement: "ram", estimatedRamGiB: useGiB });
    }
  }
  // Choose an accelerated option first. In RAM, offer a lighter starter before larger
  // candidates; CPU generation speed varies substantially and is not measured here.
  const starter = mode === "code" ? "qwen3.5:9b" : "qwen3.5:4b";
  const starterIndex = ram.findIndex((model) => model.ollamaId === starter);
  if (starterIndex > 0) ram.unshift(...ram.splice(starterIndex, 1));
  return { hardware, contextTokens, suggestions: [...gpu, ...ram].slice(0, 3) };
}
