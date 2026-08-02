import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Sparkles, Save, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  SCENE_OPTIONS,
  STYLE_OPTIONS,
  DEFAULT_FORM_STATE,
  WATERMARK_TEXT,
  buildCacheAssetPayload,
  buildDataUrl,
  buildGenerateRequest,
  validateSceneForm,
  type CultureContext,
  type GeneratedSceneResult,
  type SceneAssetPayload,
  type SceneFormState,
  type UiSceneType,
  type ImageStyle,
} from "./scene-generator-utils";

export interface SceneGeneratorProps {
  culture: CultureContext | null;
  className?: string;
}

export default function SceneGenerator({ culture, className }: SceneGeneratorProps) {
  const [form, setForm] = useState<SceneFormState>(DEFAULT_FORM_STATE);
  const [result, setResult] = useState<GeneratedSceneResult | null>(null);
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const errors = useMemo(() => validateSceneForm(form, culture), [form, culture]);
  const sceneOption = SCENE_OPTIONS.find((o) => o.value === form.sceneType);

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!culture) throw new Error("Culture required");
      const payload = buildGenerateRequest(form, culture);
      const res = await apiRequest("POST", "/api/media/generate", payload);
      return (await res.json()) as GeneratedSceneResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setSavedAssetId(null);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: SceneAssetPayload) => {
      const res = await apiRequest("POST", "/api/media-assets", payload);
      return (await res.json()) as { id: string };
    },
    onSuccess: (data) => {
      setSavedAssetId(data.id);
      if (culture) {
        queryClient.invalidateQueries({
          queryKey: [`/api/media-assets/entity/culture_profile/${culture.id}`],
        });
      }
    },
  });

  const handleGenerate = () => {
    if (errors.length > 0) return;
    generateMutation.mutate();
  };

  const handleSave = () => {
    if (!result || !culture) return;
    const payload = buildCacheAssetPayload(result, form, culture);
    saveMutation.mutate(payload);
  };

  const dataUrl = result ? buildDataUrl(result) : null;
  const isGenerating = generateMutation.isPending;
  const isSaving = saveMutation.isPending;

  return (
    <Card className={className} data-testid="scene-generator">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-start gap-2">
        <Sparkles className="h-5 w-5 text-purple-500 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Generate a Scene
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Create an AI reconstruction of a historical scene for this culture.
          </p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {!culture && (
          <div
            className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
            data-testid="scene-generator-no-culture"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Select a culture to generate a scene.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="scene-type" className="text-xs">
              Scene Type
            </Label>
            <Select
              value={form.sceneType}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, sceneType: value as UiSceneType }))
              }
            >
              <SelectTrigger id="scene-type" data-testid="scene-type-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sceneOption && (
              <p className="text-[11px] text-gray-500 mt-1">{sceneOption.helper}</p>
            )}
          </div>

          <div>
            <Label htmlFor="scene-style" className="text-xs">
              Style
            </Label>
            <Select
              value={form.style}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, style: value as ImageStyle }))
              }
            >
              <SelectTrigger id="scene-style" data-testid="scene-style-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="scene-time" className="text-xs">
              Time Period
            </Label>
            <Input
              id="scene-time"
              placeholder={culture?.timePeriod ?? "e.g. 2nd century BCE"}
              value={form.timePeriod}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, timePeriod: e.target.value }))
              }
              data-testid="scene-time-input"
            />
          </div>
          <div>
            <Label htmlFor="scene-region" className="text-xs">
              Region
            </Label>
            <Input
              id="scene-region"
              placeholder={culture?.region ?? "e.g. Central Italy"}
              value={form.region}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, region: e.target.value }))
              }
              data-testid="scene-region-input"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="scene-extras" className="text-xs">
            Specific Elements (optional)
          </Label>
          <Textarea
            id="scene-extras"
            placeholder="e.g. a household shrine, terracotta vessels, children playing with knucklebones"
            value={form.extraDetails}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, extraDetails: e.target.value }))
            }
            rows={2}
            data-testid="scene-extras-input"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleGenerate}
            disabled={errors.length > 0 || isGenerating}
            className="flex-1"
            data-testid="scene-generate-button"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating…
              </>
            ) : result ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate
              </>
            )}
          </Button>
        </div>

        {isGenerating && (
          <div
            className="space-y-1"
            data-testid="scene-generating-progress"
            aria-live="polite"
          >
            <div className="h-1 w-full rounded-full bg-purple-100 dark:bg-purple-900/30 overflow-hidden">
              <div className="h-full w-1/3 bg-purple-500 animate-pulse" />
            </div>
            <p className="text-[11px] text-gray-500">
              Composing prompt and rendering scene — this can take 15–45 seconds…
            </p>
          </div>
        )}

        {generateMutation.isError && (
          <div
            className="p-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
            data-testid="scene-generator-error"
          >
            <p className="text-xs text-red-700 dark:text-red-300">
              {(generateMutation.error as Error)?.message ?? "Image generation failed."}
            </p>
          </div>
        )}

        {result && dataUrl && (
          <div className="space-y-2" data-testid="scene-generator-result">
            <div className="relative rounded-md overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
              <img
                src={dataUrl}
                alt={`Generated ${sceneOption?.label ?? "scene"} for ${culture?.name ?? ""}`}
                className="w-full h-auto"
                data-testid="scene-generator-image"
              />
              <div
                className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded bg-black/70 text-white"
                data-testid="scene-generator-watermark"
              >
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  {WATERMARK_TEXT}
                </span>
                <Badge variant="outline" className="border-white/50 text-white text-[9px]">
                  {form.style.replace(/_/g, " ")}
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-500 truncate" title={result.prompt}>
                Prompt: {result.prompt.split("\n")[2] ?? result.prompt.slice(0, 80)}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSave}
                disabled={isSaving || savedAssetId !== null}
                data-testid="scene-save-button"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Saving…
                  </>
                ) : savedAssetId ? (
                  "Saved"
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save to gallery
                  </>
                )}
              </Button>
            </div>

            {saveMutation.isError && (
              <p className="text-[11px] text-red-600" data-testid="scene-save-error">
                {(saveMutation.error as Error)?.message ?? "Failed to save."}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
