import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import VisualizationRecommendations from "@/components/VisualizationRecommendations";
import * as d3 from 'd3';

interface LanguageContact {
  id: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  contactType: string;
  timePeriod: string;
  region: string;
  featuresTransferred: {
    phonological: string[];
    lexical: string[];
    grammatical: string[];
  };
  exampleFeatures: string;
  intensity: string;
}

interface Language {
  id: string;
  name: string;
  region: string | null;
}

interface LanguageContactsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  contactCount: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  contact: LanguageContact;
}

const CONTACT_COLORS: Record<string, string> = {
  substrate: '#8b5cf6',
  superstrate: '#ef4444',
  adstrate: '#3b82f6',
  borrowing: '#22c55e',
};

const INTENSITY_STROKE: Record<string, number> = {
  heavy: 4,
  moderate: 2.5,
  light: 1.5,
};

const CONTACT_TYPE_OPTIONS = ['all', 'substrate', 'superstrate', 'adstrate'];
const INTENSITY_OPTIONS = ['all', 'heavy', 'moderate', 'light'];

export default function LanguageContactsPanel({ isOpen, onClose, embedded }: LanguageContactsPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [contactTypeFilter, setContactTypeFilter] = useState('all');
  const [intensityFilter, setIntensityFilter] = useState('all');
  const [selectedContact, setSelectedContact] = useState<LanguageContact | null>(null);
  const [regionFilter, setRegionFilter] = useState('all');

  const { data: contactsData } = useQuery<{ contacts: LanguageContact[]; count: number }>({
    queryKey: ['/api/language-contacts'],
    enabled: isOpen || !!embedded,
  });

  const { data: languagesData } = useQuery<Language[]>({
    queryKey: ['/api/languages'],
    enabled: isOpen || !!embedded,
  });

  const languageMap = useMemo(() => {
    const map = new Map<string, Language>();
    if (languagesData) {
      for (const lang of languagesData) {
        map.set(lang.id, lang);
      }
    }
    return map;
  }, [languagesData]);

  const contacts = useMemo(() => {
    let list = contactsData?.contacts ?? [];
    if (contactTypeFilter !== 'all') {
      list = list.filter((c) => c.contactType === contactTypeFilter);
    }
    if (intensityFilter !== 'all') {
      list = list.filter((c) => c.intensity === intensityFilter);
    }
    if (regionFilter !== 'all') {
      list = list.filter((c) => c.region === regionFilter);
    }
    return list;
  }, [contactsData, contactTypeFilter, intensityFilter, regionFilter]);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const c of contactsData?.contacts ?? []) {
      if (c.region) set.add(c.region);
    }
    return Array.from(set).sort();
  }, [contactsData]);

  // Build D3 force graph
  useEffect(() => {
    if (!svgRef.current || contacts.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 700;
    const height = 500;

    // Build nodes and links
    const nodeIds = new Set<string>();
    const nodeCounts = new Map<string, number>();
    for (const c of contacts) {
      nodeIds.add(c.sourceLanguageId);
      nodeIds.add(c.targetLanguageId);
      nodeCounts.set(c.sourceLanguageId, (nodeCounts.get(c.sourceLanguageId) || 0) + 1);
      nodeCounts.set(c.targetLanguageId, (nodeCounts.get(c.targetLanguageId) || 0) + 1);
    }

    const nodes: GraphNode[] = Array.from(nodeIds).map((id) => ({
      id,
      name: languageMap.get(id)?.name || id,
      contactCount: nodeCounts.get(id) || 0,
    }));

    const links: GraphLink[] = contacts.map((c) => ({
      source: c.sourceLanguageId,
      target: c.targetLanguageId,
      contact: c,
    }));

    // Create zoom container
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Arrow markers for directed edges
    const defs = svg.append('defs');
    for (const [type, color] of Object.entries(CONTACT_COLORS)) {
      defs
        .append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('fill', color)
        .attr('d', 'M0,-5L10,0L0,5');
    }

    // Simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(100)
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(25));

    // Links
    const link = g
      .append('g')
      .selectAll<SVGLineElement, GraphLink>('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', (d) => CONTACT_COLORS[d.contact.contactType] || '#9ca3af')
      .attr('stroke-width', (d) => INTENSITY_STROKE[d.contact.intensity] || 2)
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', (d) => `url(#arrow-${d.contact.contactType})`)
      .attr('stroke-dasharray', (d) => (d.contact.contactType === 'substrate' ? '6,3' : null))
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        setSelectedContact(d.contact);
      })
      .on('mouseover', function () {
        d3.select(this).attr('stroke-opacity', 1).attr('stroke-width', function () {
          return Number(d3.select(this).attr('stroke-width')) + 2;
        });
      })
      .on('mouseout', function (_event, d) {
        d3.select(this)
          .attr('stroke-opacity', 0.6)
          .attr('stroke-width', INTENSITY_STROKE[d.contact.intensity] || 2);
      });

    // Nodes
    const node = g
      .append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .enter()
      .append('g')
      .style('cursor', 'grab')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    node
      .append('circle')
      .attr('r', (d) => Math.min(6 + d.contactCount * 1.5, 18))
      .attr('fill', '#3b82f6')
      .attr('stroke', '#1e40af')
      .attr('stroke-width', 2);

    node
      .append('text')
      .text((d) => d.name)
      .attr('x', 0)
      .attr('y', (d) => -(Math.min(6 + d.contactCount * 1.5, 18) + 4))
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#374151')
      .attr('font-weight', '500');

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0);

      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [contacts, languageMap]);

  if (!isOpen && !embedded) return null;

  const panelContent = (
    <div className={embedded ? "h-full flex flex-col bg-white" : "fixed inset-y-0 right-0 w-[900px] max-w-full bg-white shadow-xl z-50 flex flex-col"}>
      {/* Header */}
      <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-purple-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Language Contact Network</h2>
            <p className="text-sm text-gray-600 mt-1">
              Horizontal transfer between languages through contact events
            </p>
          </div>
          {!embedded && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap gap-3 items-center">
          <Filter className="h-4 w-4 text-gray-500" />
          <select
            className="text-sm border rounded px-2 py-1"
            value={contactTypeFilter}
            onChange={(e) => setContactTypeFilter(e.target.value)}
          >
            {CONTACT_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'all' ? 'All Types' : opt.charAt(0).toUpperCase() + opt.slice(1)}
              </option>
            ))}
          </select>
          <select
            className="text-sm border rounded px-2 py-1"
            value={intensityFilter}
            onChange={(e) => setIntensityFilter(e.target.value)}
          >
            {INTENSITY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'all' ? 'All Intensities' : opt.charAt(0).toUpperCase() + opt.slice(1)}
              </option>
            ))}
          </select>
          <select
            className="text-sm border rounded px-2 py-1"
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
          >
            <option value="all">All Regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500 ml-auto">
            {contacts.length} contact events
          </span>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="p-6">
            {/* Legend */}
            <div className="flex flex-wrap gap-4 mb-4 text-xs">
              {Object.entries(CONTACT_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1">
                  <div
                    className="w-6 h-0.5"
                    style={{
                      backgroundColor: color,
                      borderStyle: type === 'substrate' ? 'dashed' : 'solid',
                      borderWidth: type === 'substrate' ? '1px 0 0 0' : 0,
                      borderColor: type === 'substrate' ? color : undefined,
                      height: type === 'substrate' ? 0 : 2,
                    }}
                  />
                  <span className="capitalize text-gray-600">{type}</span>
                </div>
              ))}
              <div className="flex items-center gap-1 ml-4">
                <div className="w-4 h-1 bg-gray-400" />
                <span className="text-gray-500">thin = light</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-1.5 bg-gray-600" />
                <span className="text-gray-500">thick = heavy</span>
              </div>
            </div>

            {/* D3 Network Graph */}
            <div className="border rounded-lg bg-gray-50 overflow-hidden">
              <svg ref={svgRef} width="100%" height={500} />
            </div>

            {/* Selected Contact Detail */}
            {selectedContact && (
              <div className="mt-4 p-4 border rounded-lg bg-blue-50">
                <div className="flex justify-between items-start">
                  <h3 className="font-bold text-base">
                    {languageMap.get(selectedContact.sourceLanguageId)?.name || selectedContact.sourceLanguageId}
                    {' → '}
                    {languageMap.get(selectedContact.targetLanguageId)?.name || selectedContact.targetLanguageId}
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedContact(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                  <div>
                    <span className="text-gray-600">Type:</span>{' '}
                    <span className="font-medium capitalize">{selectedContact.contactType}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Intensity:</span>{' '}
                    <span className="font-medium capitalize">{selectedContact.intensity}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Period:</span>{' '}
                    <span className="font-medium">{selectedContact.timePeriod}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Region:</span>{' '}
                    <span className="font-medium">{selectedContact.region}</span>
                  </div>
                </div>
                {selectedContact.featuresTransferred && (
                  <div className="mt-3">
                    <span className="text-sm font-medium text-gray-700">Features Transferred:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedContact.featuresTransferred.phonological?.map((f, i) => (
                        <span key={`p-${i}`} className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded">
                          {f}
                        </span>
                      ))}
                      {selectedContact.featuresTransferred.lexical?.map((f, i) => (
                        <span key={`l-${i}`} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                          {f}
                        </span>
                      ))}
                      {selectedContact.featuresTransferred.grammatical?.map((f, i) => (
                        <span key={`g-${i}`} className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedContact.exampleFeatures && (
                  <p className="mt-2 text-sm text-gray-700">{selectedContact.exampleFeatures}</p>
                )}
              </div>
            )}

            {/* Contact List */}
            <div className="mt-6">
              <h3 className="font-semibold text-sm text-gray-700 mb-2">All Contact Events</h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {contacts.map((c) => (
                  <div
                    key={c.id}
                    className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedContact?.id === c.id ? 'border-blue-400 bg-blue-50' : ''
                    }`}
                    onClick={() => setSelectedContact(c)}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm">
                        {languageMap.get(c.sourceLanguageId)?.name || c.sourceLanguageId}
                        {' → '}
                        {languageMap.get(c.targetLanguageId)?.name || c.targetLanguageId}
                      </span>
                      <div className="flex gap-1">
                        <span
                          className="px-2 py-0.5 text-xs rounded capitalize"
                          style={{
                            backgroundColor: `${CONTACT_COLORS[c.contactType] || '#9ca3af'}20`,
                            color: CONTACT_COLORS[c.contactType] || '#6b7280',
                          }}
                        >
                          {c.contactType}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded capitalize ${
                            c.intensity === 'heavy'
                              ? 'bg-red-100 text-red-700'
                              : c.intensity === 'moderate'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {c.intensity}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {c.timePeriod} · {c.region}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="px-6 pb-4">
            <VisualizationRecommendations panelType="language-contacts" onClose={onClose} />
          </div>
        </ScrollArea>
      </div>
  );

  if (embedded) return panelContent;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50" onClick={onClose} />
      {panelContent}
    </>
  );
}
