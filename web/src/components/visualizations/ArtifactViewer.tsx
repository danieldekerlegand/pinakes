import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Eye,
  EyeOff,
  Hammer,
  ImageOff,
  Info,
  Landmark,
  MapPin,
  Quote,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Artifact,
  ArtifactAnnotation,
  clampZoom,
  describeProvenance,
  findComparableArtifacts,
  formatOriginDate,
  getArtifactKindLabel,
  getCategoryColor,
} from "./artifact-viewer-utils";

export interface ArtifactViewerProps {
  artifacts: Artifact[];
  initialArtifactId?: string;
  className?: string;
  imageHeight?: number | string;
  /**
   * Pool used to find comparable artifacts from other cultures. Defaults to
   * the `artifacts` prop.
   */
  comparablePool?: Artifact[];
  onArtifactSelect?: (artifact: Artifact) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.4;

export default function ArtifactViewer({
  artifacts,
  initialArtifactId,
  className = "",
  imageHeight = 460,
  comparablePool,
  onArtifactSelect,
}: ArtifactViewerProps) {
  const [selectedId, setSelectedId] = useState<string>(
    initialArtifactId || artifacts[0]?.id || "",
  );
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(null);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [imageError, setImageError] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const artifact =
    artifacts.find((a) => a.id === selectedId) || artifacts[0];

  const pool = comparablePool ?? artifacts;
  const comparable = useMemo(
    () =>
      artifact
        ? findComparableArtifacts(artifact, pool, {
            limit: 4,
            crossCultural: true,
          })
        : [],
    [artifact, pool],
  );

  useEffect(() => {
    setSelectedAnnotationId(null);
    setTransform({ x: 0, y: 0, scale: 1 });
    setImageError(false);
  }, [selectedId]);

  useEffect(() => {
    if (!artifacts.find((a) => a.id === selectedId) && artifacts[0]) {
      setSelectedId(artifacts[0].id);
    }
  }, [artifacts, selectedId]);

  const zoomIn = useCallback(() => {
    setTransform((t) => ({
      ...t,
      scale: clampZoom(t.scale * ZOOM_STEP, MIN_SCALE, MAX_SCALE),
    }));
  }, []);
  const zoomOut = useCallback(() => {
    setTransform((t) => ({
      ...t,
      scale: clampZoom(t.scale / ZOOM_STEP, MIN_SCALE, MAX_SCALE),
    }));
  }, []);
  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-annotation]")) return;
    if (transform.scale <= MIN_SCALE) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.x,
      ty: transform.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setTransform((t) => ({
      ...t,
      x: panStartRef.current.tx + dx,
      y: panStartRef.current.ty + dy,
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!isPanning) return;
    setIsPanning(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released
    }
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((t) => {
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        return {
          ...t,
          scale: clampZoom(t.scale * factor, MIN_SCALE, MAX_SCALE),
        };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleSelect = useCallback(
    (a: Artifact) => {
      setSelectedId(a.id);
      onArtifactSelect?.(a);
    },
    [onArtifactSelect],
  );

  if (!artifact) {
    return (
      <Card
        className={`p-6 text-center text-sm text-gray-500 ${className}`}
        data-testid="artifact-viewer-empty"
      >
        <Landmark className="h-8 w-8 mx-auto mb-2 text-gray-300" />
        <p>No artifacts available to display.</p>
      </Card>
    );
  }

  const categoryColor = getCategoryColor(artifact.category);
  const annotations: ArtifactAnnotation[] = artifact.annotations ?? [];
  const selectedAnnotation = annotations.find(
    (a) => a.id === selectedAnnotationId,
  );

  return (
    <Card
      className={`overflow-hidden ${className}`}
      data-testid="artifact-viewer"
    >
      <div className="flex items-center justify-between gap-3 p-3 border-b bg-gray-50">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="inline-flex w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: categoryColor }}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                {artifact.name}
              </h3>
              {artifact.nativeName && (
                <span className="text-xs text-gray-500 italic truncate">
                  {artifact.nativeName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] capitalize">
                {getArtifactKindLabel(artifact.kind)}
              </Badge>
              {artifact.category && (
                <Badge
                  variant="secondary"
                  className="text-[10px] capitalize"
                  style={{ color: categoryColor }}
                  data-testid="artifact-category-badge"
                >
                  {artifact.category}
                </Badge>
              )}
              <span className="text-[11px] text-gray-500">
                {formatOriginDate(artifact.originDate)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setAnnotationsVisible((v) => !v)}
            title={annotationsVisible ? "Hide annotations" : "Show annotations"}
            aria-label="Toggle annotations"
            data-testid="artifact-toggle-annotations"
          >
            {annotationsVisible ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={zoomOut}
            title="Zoom out"
            aria-label="Zoom out"
            data-testid="artifact-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={zoomIn}
            title="Zoom in"
            aria-label="Zoom in"
            data-testid="artifact-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={resetView}
            title="Reset view"
            aria-label="Reset view"
            data-testid="artifact-reset"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative bg-gradient-to-br from-stone-100 to-stone-200 select-none touch-none overflow-hidden"
        style={{
          cursor: isPanning
            ? "grabbing"
            : transform.scale > MIN_SCALE
              ? "grab"
              : "default",
          height:
            typeof imageHeight === "number" ? `${imageHeight}px` : imageHeight,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="artifact-image-viewport"
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 120ms ease-out",
          }}
        >
          {artifact.imageUrl && !imageError ? (
            <img
              src={artifact.imageUrl}
              alt={artifact.name}
              className="max-w-full max-h-full object-contain"
              draggable={false}
              onError={() => setImageError(true)}
              data-testid="artifact-image"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <ImageOff className="h-12 w-12" />
              <span className="text-xs">No image available</span>
            </div>
          )}
        </div>

        {annotationsVisible &&
          annotations.map((anno) => {
            const isActive = anno.id === selectedAnnotationId;
            return (
              <button
                key={anno.id}
                type="button"
                data-annotation={anno.id}
                data-testid={`artifact-annotation-${anno.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAnnotationId((prev) =>
                    prev === anno.id ? null : anno.id,
                  );
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md transition-transform ${
                  isActive
                    ? "w-6 h-6 bg-amber-500 scale-110"
                    : "w-5 h-5 bg-cyan-600 hover:scale-110"
                }`}
                style={{
                  left: `${clamp01(anno.x) * 100}%`,
                  top: `${clamp01(anno.y) * 100}%`,
                }}
                aria-label={`Annotation: ${anno.label}`}
                title={anno.label}
              />
            );
          })}

        <div className="absolute bottom-2 left-2 bg-white/85 rounded px-2 py-1 text-[10px] text-gray-600 backdrop-blur-sm">
          Zoom {transform.scale.toFixed(2)}×
        </div>

        {selectedAnnotation && (
          <div
            className="absolute bottom-2 right-2 max-w-xs bg-white/95 rounded-md shadow-lg border p-2"
            data-testid="artifact-annotation-popup"
          >
            <div className="text-xs font-semibold text-gray-900">
              {selectedAnnotation.label}
            </div>
            <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
              {selectedAnnotation.description}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <section data-testid="artifact-description">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1">
            <Info className="h-3 w-3" />
            About
          </h4>
          <p className="text-sm text-gray-700 mt-1 leading-relaxed">
            {artifact.description || "No description available."}
          </p>
        </section>

        <section data-testid="artifact-material">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1">
            <Hammer className="h-3 w-3" />
            Material & Technique
          </h4>
          {artifact.materials && artifact.materials.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {artifact.materials.map((mat) => (
                <Badge
                  key={mat}
                  variant="outline"
                  className="text-[10px] capitalize"
                >
                  {mat}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 mt-1">
              Material information not recorded.
            </p>
          )}
          {artifact.constructionTechnique && (
            <p className="text-xs text-gray-600 mt-2">
              <span className="font-medium text-gray-700">Technique: </span>
              {artifact.constructionTechnique}
            </p>
          )}
        </section>

        <section data-testid="artifact-provenance">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            Provenance
          </h4>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            {describeProvenance(artifact) || "Provenance details unavailable."}
          </p>
          {artifact.originCoordinates && (
            <p className="text-[11px] text-gray-500 mt-1 font-mono">
              {artifact.originCoordinates.lat.toFixed(2)},{" "}
              {artifact.originCoordinates.lng.toFixed(2)}
            </p>
          )}
        </section>

        <section data-testid="artifact-significance">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1">
            <Quote className="h-3 w-3" />
            Cultural Significance
          </h4>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            {artifact.culturalSignificance ||
              "Significance notes not recorded."}
          </p>
          {artifact.tags && artifact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {artifact.tags.slice(0, 6).map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-[10px] capitalize"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </section>
      </div>

      {comparable.length > 0 && (
        <div
          className="border-t bg-gray-50 p-3"
          data-testid="artifact-comparables"
        >
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Comparable artifacts
          </h4>
          <div className="flex gap-2 overflow-x-auto">
            {comparable.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelect(c)}
                data-testid={`artifact-comparable-${c.id}`}
                className="flex-shrink-0 w-40 text-left rounded border border-gray-200 bg-white p-2 hover:border-cyan-400 hover:shadow-sm transition-colors"
              >
                <div className="aspect-square bg-stone-100 rounded mb-1 overflow-hidden flex items-center justify-center">
                  {c.imageUrl ? (
                    <img
                      src={c.imageUrl}
                      alt={c.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <ImageOff className="h-6 w-6 text-gray-300" />
                  )}
                </div>
                <div className="text-xs font-medium text-gray-800 truncate">
                  {c.name}
                </div>
                <div className="text-[10px] text-gray-500">
                  {formatOriginDate(c.originDate)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {artifacts.length > 1 && (
        <div className="border-t bg-white px-3 py-2 flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 flex-shrink-0">
            Collection
          </span>
          {artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => handleSelect(a)}
              data-testid={`artifact-selector-${a.id}`}
              className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 whitespace-nowrap transition-colors ${
                selectedId === a.id
                  ? "bg-cyan-600 text-white border-cyan-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      {artifact.sources && artifact.sources.length > 0 && (
        <div className="border-t bg-gray-50 px-3 py-2 text-[10px] text-gray-500">
          <span className="font-semibold">Sources: </span>
          {artifact.sources.join(", ")}
        </div>
      )}
    </Card>
  );
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
