import React, { useState, useCallback } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Globe,
  Link2,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';
import type { MapBookmark } from '../../../lib/visualization/geospatial-types';
import type { MapViewState } from '../hooks/useMapBookmarks';

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

interface BookmarkPanelProps {
  builtInPresets: MapBookmark[];
  userBookmarks: MapBookmark[];
  onApplyBookmark: (bookmark: MapBookmark) => void;
  onSaveBookmark: (name: string, viewState: MapViewState, description?: string) => void;
  onDeleteBookmark: (id: string) => void;
  onGetShareableURL: (bookmark: MapBookmark) => string;
  currentViewState: MapViewState;
}

export function BookmarkPanel({
  builtInPresets,
  userBookmarks,
  onApplyBookmark,
  onSaveBookmark,
  onDeleteBookmark,
  onGetShareableURL,
  currentViewState,
}: BookmarkPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showBuiltIn, setShowBuiltIn] = useState(true);
  const [showUser, setShowUser] = useState(true);

  const handleSave = useCallback(() => {
    if (!saveName.trim()) return;
    onSaveBookmark(saveName.trim(), currentViewState, saveDescription.trim() || undefined);
    setSaveName('');
    setSaveDescription('');
    setShowSaveForm(false);
  }, [saveName, saveDescription, currentViewState, onSaveBookmark]);

  const handleCopyLink = useCallback(
    (bookmark: MapBookmark) => {
      const url = onGetShareableURL(bookmark);
      navigator.clipboard.writeText(url).then(() => {
        setCopiedId(bookmark.id);
        setTimeout(() => setCopiedId(null), 2000);
      });
    },
    [onGetShareableURL]
  );

  if (!isOpen) {
    return (
      <div className="absolute top-4 left-4 z-[1000]">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="bg-white shadow-lg"
        >
          <Bookmark className="h-4 w-4 mr-2" />
          Bookmarks
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-4 z-[1000] w-72">
      <Card className="bg-white shadow-lg">
        <div className="p-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bookmark className="h-5 w-5" />
              <h3 className="font-semibold">Bookmarks</h3>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSaveForm(!showSaveForm)}
                title="Save current view"
              >
                <BookmarkPlus className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Save Form */}
          {showSaveForm && (
            <div className="mb-3 p-2 bg-blue-50 rounded-lg border border-blue-200">
              <div className="text-xs font-medium text-blue-700 mb-2">Save Current View</div>
              <input
                type="text"
                placeholder="Bookmark name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                className="w-full px-2 py-1 text-sm border rounded mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                autoFocus
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                className="w-full px-2 py-1 text-sm border rounded mb-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <div className="flex gap-1.5">
                <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSave} disabled={!saveName.trim()}>
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowSaveForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {/* Built-in Presets */}
            <div className="border rounded-lg">
              <button
                className="w-full p-2 hover:bg-gray-50 flex items-center justify-between"
                onClick={() => setShowBuiltIn(!showBuiltIn)}
              >
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-gray-500" />
                  <span className="font-medium text-sm">View Presets</span>
                  <Badge variant="outline" className="text-xs">
                    {builtInPresets.length}
                  </Badge>
                </div>
                {showBuiltIn ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {showBuiltIn && (
                <div className="p-2 border-t bg-gray-50 space-y-1">
                  {builtInPresets.map((preset) => (
                    <BookmarkItem
                      key={preset.id}
                      bookmark={preset}
                      onApply={onApplyBookmark}
                      onCopyLink={handleCopyLink}
                      isCopied={copiedId === preset.id}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* User Bookmarks */}
            <div className="border rounded-lg">
              <button
                className="w-full p-2 hover:bg-gray-50 flex items-center justify-between"
                onClick={() => setShowUser(!showUser)}
              >
                <div className="flex items-center gap-2">
                  <Star className="h-3.5 w-3.5 text-gray-500" />
                  <span className="font-medium text-sm">My Bookmarks</span>
                  <Badge variant="outline" className="text-xs">
                    {userBookmarks.length}
                  </Badge>
                </div>
                {showUser ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {showUser && (
                <div className="p-2 border-t bg-gray-50 space-y-1">
                  {userBookmarks.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-2">
                      No bookmarks saved yet
                    </p>
                  ) : (
                    userBookmarks.map((bookmark) => (
                      <BookmarkItem
                        key={bookmark.id}
                        bookmark={bookmark}
                        onApply={onApplyBookmark}
                        onDelete={onDeleteBookmark}
                        onCopyLink={handleCopyLink}
                        isCopied={copiedId === bookmark.id}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single bookmark item
// ---------------------------------------------------------------------------

interface BookmarkItemProps {
  bookmark: MapBookmark;
  onApply: (bookmark: MapBookmark) => void;
  onDelete?: (id: string) => void;
  onCopyLink: (bookmark: MapBookmark) => void;
  isCopied: boolean;
}

function BookmarkItem({ bookmark, onApply, onDelete, onCopyLink, isCopied }: BookmarkItemProps) {
  return (
    <div className="bg-white rounded p-2 group">
      <div className="flex items-start justify-between gap-1">
        <button
          className="flex-1 text-left hover:text-blue-600 transition-colors"
          onClick={() => onApply(bookmark)}
        >
          <div className="text-sm font-medium leading-tight">{bookmark.name}</div>
          {bookmark.description && (
            <div className="text-xs text-gray-500 mt-0.5 leading-tight">{bookmark.description}</div>
          )}
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={() => onCopyLink(bookmark)}
            className="p-1 rounded hover:bg-gray-100"
            title={isCopied ? 'Copied!' : 'Copy link'}
          >
            <Link2 className={`h-3 w-3 ${isCopied ? 'text-green-600' : 'text-gray-400'}`} />
          </button>
          {onDelete && (
            <button
              onClick={() => onDelete(bookmark.id)}
              className="p-1 rounded hover:bg-red-50"
              title="Delete bookmark"
            >
              <Trash2 className="h-3 w-3 text-gray-400 hover:text-red-500" />
            </button>
          )}
        </div>
      </div>
      {/* Metadata badges */}
      <div className="flex gap-1 mt-1 flex-wrap">
        {bookmark.year != null && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1">
            {formatYear(bookmark.year)}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] h-4 px-1">
          {bookmark.activeLayers.length} layers
        </Badge>
      </div>
    </div>
  );
}
