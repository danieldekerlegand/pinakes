import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type GalleryImage,
  type GallerySortOrder,
  getMediaTypeColor,
  getUniqueTags,
  filterByTag,
  filterByMediaType,
  sortImages,
  clampZoom,
  nextIndex,
  prevIndex,
  normalizeLicense,
} from "./image-gallery-utils";

export type { GalleryImage };

interface ImageGalleryProps {
  images: GalleryImage[];
  layout?: "grid" | "masonry";
  emptyMessage?: string;
  className?: string;
  initialSort?: GallerySortOrder;
  showFilters?: boolean;
}

export function ImageGallery({
  images,
  layout = "grid",
  emptyMessage = "No images available",
  className,
  initialSort = "relevance",
  showFilters = true,
}: ImageGalleryProps) {
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<GallerySortOrder>(initialSort);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const tags = useMemo(() => getUniqueTags(images), [images]);
  const mediaTypes = useMemo(() => {
    const set = new Set<string>();
    for (const img of images) {
      if (img.mediaType) set.add(img.mediaType);
    }
    return Array.from(set).sort();
  }, [images]);

  const displayed = useMemo(() => {
    let list = images;
    list = filterByTag(list, selectedTag);
    list = filterByMediaType(list, selectedType);
    list = sortImages(list, sortOrder);
    return list;
  }, [images, selectedTag, selectedType, sortOrder]);

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  if (displayed.length === 0 && images.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400",
          className,
        )}
        data-testid="image-gallery-empty"
      >
        <ImageIcon className="h-12 w-12 mb-2 opacity-40" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} data-testid="image-gallery">
      {showFilters && (tags.length > 0 || mediaTypes.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          {mediaTypes.length > 0 && (
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-40 h-8" data-testid="filter-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {mediaTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {tags.length > 0 && (
            <Select value={selectedTag} onValueChange={setSelectedTag}>
              <SelectTrigger className="w-40 h-8" data-testid="filter-tag">
                <SelectValue placeholder="All tags" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tags</SelectItem>
                {tags.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={sortOrder}
            onValueChange={(v) => setSortOrder(v as GallerySortOrder)}
          >
            <SelectTrigger className="w-36 h-8" data-testid="sort-order">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">Relevance</SelectItem>
              <SelectItem value="date">Newest</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
            {displayed.length} of {images.length}
          </span>
        </div>
      )}

      {displayed.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-8 text-gray-500 dark:text-gray-400"
          data-testid="image-gallery-no-matches"
        >
          <p className="text-sm">No images match the current filters</p>
        </div>
      ) : layout === "masonry" ? (
        <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [column-fill:_balance]">
          {displayed.map((img, i) => (
            <GalleryThumbnail
              key={img.id}
              image={img}
              onClick={() => openLightbox(i)}
              masonry
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {displayed.map((img, i) => (
            <GalleryThumbnail
              key={img.id}
              image={img}
              onClick={() => openLightbox(i)}
            />
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          images={displayed}
          index={lightboxIndex}
          onClose={closeLightbox}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}

interface GalleryThumbnailProps {
  image: GalleryImage;
  onClick: () => void;
  masonry?: boolean;
}

function GalleryThumbnail({ image, onClick, masonry }: GalleryThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-left focus:outline-none focus:ring-2 focus:ring-blue-500",
        masonry ? "mb-3 break-inside-avoid w-full" : "aspect-square w-full",
      )}
      data-testid={`gallery-thumb-${image.id}`}
      aria-label={`Open ${image.title}`}
    >
      {!loaded && !errored && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700" />
      )}
      {errored ? (
        <div className="flex items-center justify-center h-full min-h-[120px] text-gray-400">
          <ImageIcon className="h-8 w-8" />
        </div>
      ) : (
        <img
          src={image.url}
          alt={image.title}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={cn(
            "w-full transition-transform duration-200 group-hover:scale-105",
            masonry ? "h-auto" : "h-full object-cover",
            !loaded && "opacity-0",
          )}
        />
      )}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-white text-xs font-medium line-clamp-2">
          {image.title}
        </p>
      </div>
      {image.mediaType && (
        <Badge
          className="absolute top-1 right-1 text-[10px] px-1.5 py-0"
          style={{ backgroundColor: getMediaTypeColor(image.mediaType) }}
        >
          {image.mediaType}
        </Badge>
      )}
    </button>
  );
}

interface LightboxProps {
  images: GalleryImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

function Lightbox({ images, index, onClose, onNavigate }: LightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );

  const current = images[index];

  const goNext = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    onNavigate(nextIndex(index, images.length));
  }, [index, images.length, onNavigate]);

  const goPrev = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    onNavigate(prevIndex(index, images.length));
  }, [index, images.length, onNavigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=")
        setZoom((z) => clampZoom(z + 0.25));
      else if (e.key === "-") setZoom((z) => clampZoom(z - 0.25));
      else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, onClose]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current) return;
    setPan({
      x: dragState.current.panX + (e.clientX - dragState.current.startX),
      y: dragState.current.panY + (e.clientY - dragState.current.startY),
    });
  };

  const onMouseUp = () => {
    dragState.current = null;
  };

  if (!current) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-5xl w-[95vw] h-[90vh] p-0 overflow-hidden flex flex-col bg-black border-0"
        data-testid="image-lightbox"
      >
        <DialogTitle className="sr-only">{current.title}</DialogTitle>
        <DialogDescription className="sr-only">
          {current.description ?? current.title}
        </DialogDescription>

        <div
          className="relative flex-1 overflow-hidden flex items-center justify-center"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <img
            src={current.url}
            alt={current.title}
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? "grab" : "default",
            }}
            className="max-w-full max-h-full object-contain transition-transform duration-100 select-none"
            data-testid="lightbox-image"
          />

          {images.length > 1 && (
            <>
              <Button
                variant="secondary"
                size="icon"
                onClick={goPrev}
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full opacity-80 hover:opacity-100"
                data-testid="lightbox-prev"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={goNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full opacity-80 hover:opacity-100"
                data-testid="lightbox-next"
                aria-label="Next image"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          )}

          <div className="absolute top-4 left-4 flex gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setZoom((z) => clampZoom(z + 0.25))}
              className="rounded-full opacity-80 hover:opacity-100"
              data-testid="lightbox-zoom-in"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setZoom((z) => clampZoom(z - 0.25))}
              className="rounded-full opacity-80 hover:opacity-100"
              data-testid="lightbox-zoom-out"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="rounded-full opacity-80 hover:opacity-100"
              data-testid="lightbox-reset"
              aria-label="Reset zoom"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {images.length > 1 && (
            <div
              className="absolute top-4 right-14 text-white text-xs bg-black/60 px-2 py-1 rounded"
              data-testid="lightbox-counter"
            >
              {index + 1} / {images.length}
            </div>
          )}
        </div>

        <div className="bg-gray-900 text-white px-4 py-3 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-semibold text-sm truncate">
                {current.title}
              </h3>
              {current.description && (
                <p className="text-xs text-gray-300 mt-1 line-clamp-2">
                  {current.description}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 text-xs text-gray-300 flex-shrink-0">
              {current.mediaType && (
                <Badge
                  style={{ backgroundColor: getMediaTypeColor(current.mediaType) }}
                  className="text-[10px]"
                >
                  {current.mediaType}
                </Badge>
              )}
              {current.dateAdded && <span>{current.dateAdded}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-gray-400">
            <span data-testid="lightbox-license">
              {normalizeLicense(current.license)}
            </span>
            {current.attribution && (
              <>
                <span>·</span>
                <span>by {current.attribution}</span>
              </>
            )}
            {current.source && (
              <>
                <span>·</span>
                <a
                  href={current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-white"
                >
                  {current.source}
                </a>
              </>
            )}
            {current.tags && current.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 ml-auto">
                {current.tags.slice(0, 5).map((t) => (
                  <Badge
                    key={t}
                    variant="outline"
                    className="text-[10px] border-gray-600 text-gray-300"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ImageGallery;
