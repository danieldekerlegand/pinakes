import * as turf from '@turf/turf';
import * as fs from 'fs';
import * as path from 'path';
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
  GeoJsonProperties,
} from 'geojson';

/**
 * Boundary resolution source type.
 * - 'geojson': Pre-loaded GeoJSON boundary data
 * - 'composite': Union of multiple named regions
 */
export type BoundarySourceType = 'geojson' | 'composite';

export interface BoundaryDefinition {
  /** Unique identifier for this boundary */
  id: string;
  /** Human-readable name */
  name: string;
  /** Aliases for name-based lookup */
  aliases?: string[];
  /** The resolved GeoJSON geometry */
  geometry: Polygon | MultiPolygon;
  /** Source attribution */
  source: string;
  /** Simplification tolerance applied (if any) */
  simplificationTolerance?: number;
}

export interface CompositeRegionDefinition {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** IDs of constituent regions to union together */
  componentRegionIds: string[];
}

export interface BoundaryResolverOptions {
  /** Directory containing GeoJSON boundary files */
  dataDir?: string;
  /** Default simplification tolerance (0 = no simplification) */
  defaultSimplifyTolerance?: number;
}

/**
 * BoundaryResolver resolves named regions to precise GeoJSON boundaries.
 *
 * It loads boundary data from GeoJSON files, supports name-based lookup,
 * caching, composite region creation (union of multiple areas), and
 * geometry simplification for performance.
 */
export class BoundaryResolver {
  private boundaries: Map<string, BoundaryDefinition> = new Map();
  private nameIndex: Map<string, string> = new Map(); // normalized name -> id
  private compositeRegions: Map<string, CompositeRegionDefinition> = new Map();
  private compositeCache: Map<string, BoundaryDefinition> = new Map();
  private dataDir: string;
  private defaultSimplifyTolerance: number;

  constructor(options: BoundaryResolverOptions = {}) {
    this.dataDir = options.dataDir ?? path.join(process.cwd(), 'data', 'boundaries');
    this.defaultSimplifyTolerance = options.defaultSimplifyTolerance ?? 0;
  }

  /**
   * Load GeoJSON boundary files from the data directory.
   * Each file should be a GeoJSON FeatureCollection with named features.
   */
  async loadBoundariesFromDirectory(dirPath?: string): Promise<number> {
    const dir = dirPath ?? this.dataDir;
    if (!fs.existsSync(dir)) {
      return 0;
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.geojson') || f.endsWith('.json'));
    let count = 0;

    for (const file of files) {
      const filePath = path.join(dir, file);
      const loaded = await this.loadGeoJSONFile(filePath);
      count += loaded;
    }

    return count;
  }

  /**
   * Load a single GeoJSON file and register its features as boundaries.
   */
  async loadGeoJSONFile(filePath: string): Promise<number> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const geojson = JSON.parse(raw);
    const source = path.basename(filePath);
    let count = 0;

    if (geojson.type === 'FeatureCollection') {
      for (const feature of (geojson as FeatureCollection).features) {
        if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
          const name = feature.properties?.name ?? feature.properties?.NAME ?? source.replace(/\.\w+$/, '');
          const id = feature.id?.toString() ?? feature.properties?.id ?? `${source}-${count}`;
          this.registerBoundary({
            id,
            name,
            geometry: feature.geometry as Polygon | MultiPolygon,
            source,
            aliases: extractAliases(feature.properties),
          });
          count++;
        }
      }
    } else if (geojson.type === 'Feature') {
      const feature = geojson as Feature;
      if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        const name = feature.properties?.name ?? feature.properties?.NAME ?? source.replace(/\.\w+$/, '');
        const id = feature.id?.toString() ?? feature.properties?.id ?? source.replace(/\.\w+$/, '');
        this.registerBoundary({
          id,
          name,
          geometry: feature.geometry as Polygon | MultiPolygon,
          source,
          aliases: extractAliases(feature.properties),
        });
        count++;
      }
    }

    return count;
  }

  /**
   * Register a boundary definition directly.
   */
  registerBoundary(boundary: BoundaryDefinition): void {
    this.boundaries.set(boundary.id, boundary);
    this.nameIndex.set(normalizeName(boundary.name), boundary.id);
    if (boundary.aliases) {
      for (const alias of boundary.aliases) {
        this.nameIndex.set(normalizeName(alias), boundary.id);
      }
    }
  }

  /**
   * Register a composite region definition (union of multiple regions).
   */
  registerCompositeRegion(definition: CompositeRegionDefinition): void {
    this.compositeRegions.set(definition.id, definition);
    this.nameIndex.set(normalizeName(definition.name), definition.id);
  }

  /**
   * Resolve a region by ID or name to a precise GeoJSON boundary.
   */
  resolve(idOrName: string, simplifyTolerance?: number): BoundaryDefinition | null {
    // Direct ID lookup
    const direct = this.boundaries.get(idOrName);
    if (direct) {
      return this.maybeSimplify(direct, simplifyTolerance);
    }

    // Check composite regions
    const composite = this.compositeRegions.get(idOrName);
    if (composite) {
      return this.resolveComposite(composite, simplifyTolerance);
    }

    // Name-based lookup
    const normalizedName = normalizeName(idOrName);
    const resolvedId = this.nameIndex.get(normalizedName);
    if (resolvedId) {
      // Could be a boundary or composite
      const boundary = this.boundaries.get(resolvedId);
      if (boundary) {
        return this.maybeSimplify(boundary, simplifyTolerance);
      }
      const comp = this.compositeRegions.get(resolvedId);
      if (comp) {
        return this.resolveComposite(comp, simplifyTolerance);
      }
    }

    // Fuzzy search fallback
    return this.fuzzySearch(idOrName, simplifyTolerance);
  }

  /**
   * Resolve a GeoJSON feature by enhancing its geometry with precise boundaries.
   * If the feature's region name matches a known boundary, replaces the geometry.
   * Falls back to the original geometry if no match is found.
   */
  resolveFeature<P extends GeoJsonProperties>(
    feature: Feature<Polygon | MultiPolygon, P>,
    regionNameKey: string = 'name'
  ): Feature<Polygon | MultiPolygon, P> {
    const regionName = feature.properties?.[regionNameKey] as string | undefined;
    if (!regionName) return feature;

    const resolved = this.resolve(regionName);
    if (!resolved) return feature;

    return {
      ...feature,
      geometry: resolved.geometry,
      properties: {
        ...feature.properties,
        _boundarySource: resolved.source,
        _boundaryResolved: true,
      } as P,
    };
  }

  /**
   * Resolve multiple features, replacing geometries where precise boundaries are available.
   */
  resolveFeatures<P extends GeoJsonProperties>(
    features: Feature<Polygon | MultiPolygon, P>[],
    regionNameKey: string = 'name'
  ): Feature<Polygon | MultiPolygon, P>[] {
    return features.map(f => this.resolveFeature(f, regionNameKey));
  }

  /**
   * Get all registered boundary IDs.
   */
  listBoundaryIds(): string[] {
    return Array.from(this.boundaries.keys());
  }

  /**
   * Get all registered boundary names.
   */
  listBoundaryNames(): string[] {
    return Array.from(this.boundaries.values()).map(b => b.name);
  }

  /**
   * Search boundaries by partial name match.
   */
  search(query: string, limit: number = 10): BoundaryDefinition[] {
    const normalized = normalizeName(query);
    const results: BoundaryDefinition[] = [];

    for (const boundary of Array.from(this.boundaries.values())) {
      const nameNorm = normalizeName(boundary.name);
      if (nameNorm.includes(normalized) || normalized.includes(nameNorm)) {
        results.push(boundary);
        if (results.length >= limit) break;
      }
      if (boundary.aliases) {
        for (const alias of boundary.aliases) {
          if (normalizeName(alias).includes(normalized)) {
            results.push(boundary);
            break;
          }
        }
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /**
   * Get the total number of registered boundaries.
   */
  get size(): number {
    return this.boundaries.size;
  }

  // ---- Private methods ----

  private resolveComposite(
    definition: CompositeRegionDefinition,
    simplifyTolerance?: number
  ): BoundaryDefinition | null {
    // Check cache
    const cached = this.compositeCache.get(definition.id);
    if (cached) return this.maybeSimplify(cached, simplifyTolerance);

    const components: Feature<Polygon | MultiPolygon>[] = [];
    for (const componentId of definition.componentRegionIds) {
      const boundary = this.boundaries.get(componentId);
      if (boundary) {
        components.push(turf.feature(boundary.geometry));
      }
    }

    if (components.length === 0) return null;

    let unionGeometry: Polygon | MultiPolygon;
    if (components.length === 1) {
      unionGeometry = components[0].geometry;
    } else {
      // Union all components together
      let result = components[0];
      for (let i = 1; i < components.length; i++) {
        const unionResult = turf.union(
          turf.featureCollection([result, components[i]])
        );
        if (unionResult) {
          result = unionResult as Feature<Polygon | MultiPolygon>;
        }
      }
      unionGeometry = result.geometry;
    }

    const resolved: BoundaryDefinition = {
      id: definition.id,
      name: definition.name,
      geometry: unionGeometry,
      source: 'composite',
    };

    this.compositeCache.set(definition.id, resolved);
    return this.maybeSimplify(resolved, simplifyTolerance);
  }

  private maybeSimplify(
    boundary: BoundaryDefinition,
    tolerance?: number
  ): BoundaryDefinition {
    const tol = tolerance ?? this.defaultSimplifyTolerance;
    if (tol <= 0) return boundary;

    const simplified = turf.simplify(turf.feature(boundary.geometry), {
      tolerance: tol,
      highQuality: true,
    });

    return {
      ...boundary,
      geometry: simplified.geometry as Polygon | MultiPolygon,
      simplificationTolerance: tol,
    };
  }

  private fuzzySearch(
    query: string,
    simplifyTolerance?: number
  ): BoundaryDefinition | null {
    const normalized = normalizeName(query);

    // Try substring matching
    for (const [name, id] of Array.from(this.nameIndex.entries())) {
      if (name.includes(normalized) || normalized.includes(name)) {
        const boundary = this.boundaries.get(id);
        if (boundary) {
          return this.maybeSimplify(boundary, simplifyTolerance);
        }
      }
    }

    return null;
  }
}

// ---- Utility functions ----

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

function extractAliases(properties: GeoJsonProperties | null): string[] {
  if (!properties) return [];
  const aliases: string[] = [];
  const aliasKeys = ['NAME_LONG', 'NAME_EN', 'name_en', 'name_long', 'ADMIN', 'admin', 'aliases'];
  for (const key of aliasKeys) {
    const val = properties[key];
    if (typeof val === 'string' && val.length > 0) {
      aliases.push(val);
    } else if (Array.isArray(val)) {
      aliases.push(...val.filter((v: unknown) => typeof v === 'string'));
    }
  }
  return aliases;
}

// Singleton instance
let defaultResolver: BoundaryResolver | null = null;

/**
 * Get or create the default BoundaryResolver instance.
 * Loads boundaries from data/boundaries/ and sources/glottolog/ on first call.
 */
export async function getDefaultBoundaryResolver(): Promise<BoundaryResolver> {
  if (defaultResolver) return defaultResolver;

  const resolver = new BoundaryResolver();

  // Load from data/boundaries if it exists
  await resolver.loadBoundariesFromDirectory();

  // Load Glottolog voronoi macroarea boundaries
  const glottologDir = path.join(process.cwd(), 'sources', 'glottolog', 'config', 'macroareas', 'voronoi');
  await resolver.loadBoundariesFromDirectory(glottologDir);

  // Register well-known composite regions
  registerWellKnownComposites(resolver);

  defaultResolver = resolver;
  return resolver;
}

/**
 * Register well-known composite region definitions.
 */
function registerWellKnownComposites(resolver: BoundaryResolver): void {
  const composites: CompositeRegionDefinition[] = [
    {
      id: 'fertile-crescent',
      name: 'Fertile Crescent',
      componentRegionIds: ['iraq', 'syria', 'lebanon', 'jordan', 'israel', 'palestine', 'kuwait'],
    },
    {
      id: 'mediterranean-basin',
      name: 'Mediterranean Basin',
      componentRegionIds: ['italy', 'greece', 'spain', 'france', 'turkey', 'egypt', 'tunisia', 'libya', 'algeria', 'morocco'],
    },
    {
      id: 'mesopotamia',
      name: 'Mesopotamia',
      componentRegionIds: ['iraq', 'syria-east'],
    },
    {
      id: 'levant',
      name: 'Levant',
      componentRegionIds: ['syria', 'lebanon', 'jordan', 'israel', 'palestine'],
    },
    {
      id: 'anatolia',
      name: 'Anatolia',
      componentRegionIds: ['turkey'],
    },
  ];

  for (const composite of composites) {
    resolver.registerCompositeRegion(composite);
  }
}

/**
 * Reset the default resolver (for testing).
 */
export function resetDefaultBoundaryResolver(): void {
  defaultResolver = null;
}
