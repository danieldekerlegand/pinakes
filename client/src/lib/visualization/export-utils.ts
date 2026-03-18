/**
 * Export utilities for visualization data and images
 */

/**
 * Download a blob as a file
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export SVG element to SVG file
 */
export function exportSVG(svgElement: SVGSVGElement, filename: string = 'visualization.svg') {
  try {
    // Clone the SVG to avoid modifying the original
    const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;

    // Add XML namespace if not present
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    // Serialize SVG
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clonedSvg);

    // Create blob and download
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, filename);

    return true;
  } catch (error) {
    console.error('Error exporting SVG:', error);
    return false;
  }
}

/**
 * Draw a watermark on a canvas context
 */
function drawWatermark(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  scale: number
) {
  const text = 'LinguaScrape';
  const padding = 12;
  const fontSize = 14;

  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize;

  // Position at bottom-right
  const x = canvasWidth / scale - textWidth - padding;
  const y = canvasHeight / scale - padding;

  // Semi-transparent background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  const bgPadding = 6;
  ctx.beginPath();
  ctx.roundRect(
    x - bgPadding,
    y - textHeight - bgPadding + 2,
    textWidth + bgPadding * 2,
    textHeight + bgPadding * 2,
    4
  );
  ctx.fill();

  // White text
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Export SVG element to PNG file
 * Uses canvas to convert SVG to PNG, with optional watermark
 */
export async function exportPNG(
  svgElement: SVGSVGElement,
  filename: string = 'visualization.png',
  scale: number = 2,
  watermark: boolean = true
): Promise<boolean> {
  try {
    // Get SVG dimensions
    const bbox = svgElement.getBoundingClientRect();
    const width = bbox.width;
    const height = bbox.height;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    // Scale for higher resolution
    ctx.scale(scale, scale);

    // Serialize SVG
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svgElement);

    // Add XML namespace if not present
    if (!svgString.includes('xmlns')) {
      svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Create blob from SVG string
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    // Load SVG into image
    const img = new Image();
    img.width = width;
    img.height = height;

    return new Promise((resolve) => {
      img.onload = () => {
        // Draw white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);

        // Draw image
        ctx.drawImage(img, 0, 0, width, height);

        // Draw watermark
        if (watermark) {
          drawWatermark(ctx, canvas.width, canvas.height, scale);
        }

        // Convert canvas to blob and download
        canvas.toBlob((blob) => {
          if (blob) {
            downloadBlob(blob, filename);
            URL.revokeObjectURL(url);
            resolve(true);
          } else {
            resolve(false);
          }
        }, 'image/png');
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };

      img.src = url;
    });
  } catch (error) {
    console.error('Error exporting PNG:', error);
    return false;
  }
}

/**
 * Export data to CSV format
 */
export function exportCSV(
  data: any[],
  filename: string = 'data.csv',
  columns?: string[]
) {
  try {
    if (data.length === 0) {
      console.warn('No data to export');
      return false;
    }

    // Determine columns
    const cols = columns || Object.keys(data[0]);

    // Create CSV header
    const header = cols.join(',');

    // Create CSV rows
    const rows = data.map((item) => {
      return cols.map((col) => {
        const value = item[col];

        // Handle different value types
        if (value === null || value === undefined) {
          return '';
        }

        // Convert objects/arrays to JSON strings
        if (typeof value === 'object') {
          return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        }

        // Escape strings containing commas or quotes
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }

        return value;
      }).join(',');
    });

    // Combine header and rows
    const csv = [header, ...rows].join('\n');

    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, filename);

    return true;
  } catch (error) {
    console.error('Error exporting CSV:', error);
    return false;
  }
}

/**
 * Export data to JSON format
 */
export function exportJSON(
  data: any,
  filename: string = 'data.json'
) {
  try {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    downloadBlob(blob, filename);
    return true;
  } catch (error) {
    console.error('Error exporting JSON:', error);
    return false;
  }
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    return false;
  }
}

export interface EmbedOptions {
  view: string;
  width?: number | string;
  height?: number | string;
  theme?: 'light' | 'dark';
}

/**
 * Generate an HTML embed snippet for a visualization
 */
export function generateEmbedCode(baseUrl: string, options: EmbedOptions): string {
  const { view, width = '100%', height = 500, theme = 'light' } = options;
  const params = new URLSearchParams({ view, theme });
  const src = `${baseUrl}/embed?${params.toString()}`;
  const widthAttr = typeof width === 'number' ? `${width}px` : width;
  const heightAttr = typeof height === 'number' ? `${height}px` : height;

  return `<iframe src="${src}" style="width:${widthAttr};height:${heightAttr};border:none;border-radius:8px;" loading="lazy" title="LinguaScrape - ${view} visualization"></iframe>`;
}
