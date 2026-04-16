import { useQuery } from "@tanstack/react-query";
import { ImageGallery } from "./ImageGallery";
import type { GalleryImage } from "./image-gallery-utils";

interface MediaAsset {
  id: string;
  entityType: string;
  entityId: string;
  mediaType: string;
  url: string;
  title: string;
  description: string;
  source: string;
  license: string;
  attribution: string;
  tags: string[];
  dateAdded: string;
  width: number | null;
  height: number | null;
}

interface MediaAssetsResponse {
  assets: MediaAsset[];
  count: number;
}

interface CultureMediaGalleryProps {
  entityType: string;
  entityId: string;
  layout?: "grid" | "masonry";
  emptyMessage?: string;
  className?: string;
  showFilters?: boolean;
}

function toGalleryImage(asset: MediaAsset): GalleryImage {
  return {
    id: asset.id,
    url: asset.url,
    title: asset.title,
    description: asset.description,
    source: asset.source,
    license: asset.license,
    attribution: asset.attribution,
    mediaType: asset.mediaType,
    tags: asset.tags,
    dateAdded: asset.dateAdded,
    width: asset.width,
    height: asset.height,
  };
}

export function CultureMediaGallery({
  entityType,
  entityId,
  layout = "grid",
  emptyMessage = "No images available for this culture yet",
  className,
  showFilters = true,
}: CultureMediaGalleryProps) {
  const { data, isLoading } = useQuery<MediaAssetsResponse>({
    queryKey: [`/api/media-assets/entity/${entityType}/${entityId}`],
    enabled: !!entityId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 animate-pulse"
        data-testid="culture-media-gallery-loading"
      >
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg bg-gray-200 dark:bg-gray-700"
          />
        ))}
      </div>
    );
  }

  const images = (data?.assets ?? []).map(toGalleryImage);

  return (
    <ImageGallery
      images={images}
      layout={layout}
      emptyMessage={emptyMessage}
      className={className}
      showFilters={showFilters}
    />
  );
}

export default CultureMediaGallery;
