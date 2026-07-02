import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Trash2, AlertTriangle, ChevronDown, ChevronRight, Languages, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { LanguageFamilyWithChildren, LanguageWithVariants } from "@shared/types";

interface LanguageFamilyManagerProps {
  onRefresh?: () => void;
}

interface DeletionPreview {
  families: number;
  languages: number;
  translations: number;
  jobs: number;
}

export function LanguageFamilyManager({ onRefresh }: LanguageFamilyManagerProps) {
  const [families, setFamilies] = useState<LanguageFamilyWithChildren[]>([]);
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletePreview, setDeletePreview] = useState<DeletionPreview | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'family' | 'language' | 'bulk', id?: string, name?: string } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadLanguageFamilies();
  }, []);

  const loadLanguageFamilies = async () => {
    try {
      const response = await fetch("/api/language-families/tree");
      const data = await response.json();
      setFamilies(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load language families",
        variant: "destructive",
      });
    }
  };

  const toggleFamilyExpansion = (familyId: string) => {
    setExpandedFamilies(prev => {
      const newSet = new Set(prev);
      if (newSet.has(familyId)) {
        newSet.delete(familyId);
      } else {
        newSet.add(familyId);
      }
      return newSet;
    });
  };

  const toggleItemSelection = (itemId: string, itemType: 'family' | 'language') => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      const key = `${itemType}:${itemId}`;
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const calculateDeletionPreview = async (type: 'family' | 'language' | 'bulk', id?: string): Promise<DeletionPreview> => {
    // This is a simplified preview - in a real implementation, you'd make API calls
    // to get accurate counts of what will be deleted
    if (type === 'family' && id) {
      const family = findFamilyById(id, families);
      if (!family) return { families: 0, languages: 0, translations: 0, jobs: 0 };
      
      const allFamilies = getAllChildFamilies(family);
      const allLanguages = getAllLanguagesInFamilies(allFamilies);
      
      return {
        families: allFamilies.length,
        languages: allLanguages.length,
        translations: allLanguages.length * 30, // Estimate
        jobs: allLanguages.length * 2, // Estimate
      };
    } else if (type === 'language' && id) {
      return {
        families: 0,
        languages: 1,
        translations: 30, // Estimate
        jobs: 2, // Estimate
      };
    } else {
      // Bulk deletion
      const selectedFamilies = Array.from(selectedItems).filter(item => item.startsWith('family:')).map(item => item.replace('family:', ''));
      const selectedLanguages = Array.from(selectedItems).filter(item => item.startsWith('language:')).map(item => item.replace('language:', ''));
      
      const allFamilies = selectedFamilies.flatMap(id => {
        const family = findFamilyById(id, families);
        return family ? getAllChildFamilies(family) : [];
      });
      
      const allLanguages = [
        ...selectedLanguages.map(id => findLanguageById(id, families)).filter(Boolean) as LanguageWithVariants[],
        ...getAllLanguagesInFamilies(allFamilies)
      ];
      
      return {
        families: allFamilies.length,
        languages: allLanguages.length,
        translations: allLanguages.length * 30, // Estimate
        jobs: allLanguages.length * 2, // Estimate
      };
    }
  };

  const findFamilyById = (id: string, familiesList: LanguageFamilyWithChildren[]): LanguageFamilyWithChildren | null => {
    for (const family of familiesList) {
      if (family.id === id) return family;
      const found = findFamilyById(id, family.children);
      if (found) return found;
    }
    return null;
  };

  const findLanguageById = (id: string, familiesList: LanguageFamilyWithChildren[]): LanguageWithVariants | null => {
    for (const family of familiesList) {
      const found = family.languages.find(lang => lang.id === id);
      if (found) return found;
      const foundInChildren = findLanguageById(id, family.children);
      if (foundInChildren) return foundInChildren;
    }
    return null;
  };

  const getAllChildFamilies = (family: LanguageFamilyWithChildren): LanguageFamilyWithChildren[] => {
    const result = [family];
    for (const child of family.children) {
      result.push(...getAllChildFamilies(child));
    }
    return result;
  };

  const getAllLanguagesInFamilies = (familiesList: LanguageFamilyWithChildren[]): LanguageWithVariants[] => {
    const result: LanguageWithVariants[] = [];
    for (const family of familiesList) {
      result.push(...family.languages);
      for (const child of family.children) {
        result.push(...getAllLanguagesInFamilies([child]));
      }
    }
    return result;
  };

  const handleDeleteClick = async (type: 'family' | 'language' | 'bulk', id?: string, name?: string) => {
    setDeleteTarget({ type, id, name });
    const preview = await calculateDeletionPreview(type, id);
    setDeletePreview(preview);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    
    setIsDeleting(true);
    try {
      let response;
      
      if (deleteTarget.type === 'family' && deleteTarget.id) {
        response = await fetch(`/api/language-families/${deleteTarget.id}`, {
          method: 'DELETE',
        });
      } else if (deleteTarget.type === 'language' && deleteTarget.id) {
        response = await fetch(`/api/languages/${deleteTarget.id}`, {
          method: 'DELETE',
        });
      } else if (deleteTarget.type === 'bulk') {
        const selectedFamilies = Array.from(selectedItems)
          .filter(item => item.startsWith('family:'))
          .map(item => item.replace('family:', ''));
        const selectedLanguages = Array.from(selectedItems)
          .filter(item => item.startsWith('language:'))
          .map(item => item.replace('language:', ''));
        
        // Determine which endpoint to call based on what's selected
        if (selectedFamilies.length > 0 && selectedLanguages.length === 0) {
          response = await fetch('/api/language-families', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedFamilies }),
          });
        } else if (selectedLanguages.length > 0 && selectedFamilies.length === 0) {
          response = await fetch('/api/languages', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedLanguages }),
          });
        } else {
          // Mixed selection - handle separately
          await Promise.all([
            ...(selectedFamilies.length > 0 ? [fetch('/api/language-families', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: selectedFamilies }),
            })] : []),
            ...(selectedLanguages.length > 0 ? [fetch('/api/languages', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: selectedLanguages }),
            })] : []),
          ]);
          response = { ok: true } as Response;
        }
      }
      
      if (response && !response.ok) {
        throw new Error('Delete operation failed');
      }
      
      toast({
        title: "Success",
        description: "Items deleted successfully",
      });
      
      setSelectedItems(new Set());
      await loadLanguageFamilies();
      onRefresh?.();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete items",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setDeleteTarget(null);
      setDeletePreview(null);
    }
  };

  const renderLanguage = (language: LanguageWithVariants, familyId: string) => {
    const isSelected = selectedItems.has(`language:${language.id}`);
    
    return (
      <div key={language.id} className="flex items-center justify-between py-2 px-4 hover:bg-muted/50 rounded-lg">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleItemSelection(language.id, 'language')}
          />
          <div className="flex items-center gap-2">
            <Languages className="h-4 w-4 text-blue-500" />
            <span className="font-medium">{language.name}</span>
            {language.nativeName && (
              <span className="text-sm text-muted-foreground">({language.nativeName})</span>
            )}
            <Badge variant="outline" className="text-xs">
              {language.status}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleDeleteClick('language', language.id, language.name)}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const renderFamily = (family: LanguageFamilyWithChildren, level: number = 0) => {
    const isExpanded = expandedFamilies.has(family.id);
    const isSelected = selectedItems.has(`family:${family.id}`);
    const hasChildren = family.children.length > 0 || family.languages.length > 0;
    
    return (
      <div key={family.id} className={level > 0 ? 'ml-6' : ''}>
        <div className="flex items-center justify-between py-3 px-4 hover:bg-muted/50 rounded-lg">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleItemSelection(family.id, 'family')}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleFamilyExpansion(family.id)}
                className="h-6 w-6 p-0"
              >
                {hasChildren ? (
                  isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                ) : (
                  <div className="h-4 w-4" />
                )}
              </Button>
              <Globe className="h-4 w-4 text-green-500" />
              <span className="font-medium">{family.name}</span>
              <Badge variant="secondary" className="text-xs">
                {family.taxonomicLevel}
              </Badge>
              {(family.languageCount ?? 0) > 0 && (
                <Badge variant="outline" className="text-xs">
                  {family.languageCount} languages
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDeleteClick('family', family.id, family.name)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        
        {isExpanded && (
          <div className="space-y-1">
            {family.languages.map(language => renderLanguage(language, family.id))}
            {family.children.map(child => renderFamily(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const hasSelections = selectedItems.size > 0;

  return (
    <div className="space-y-4">
      {/* Bulk actions */}
      {hasSelections && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <span className="text-sm font-medium text-orange-800">
                  {selectedItems.size} item{selectedItems.size !== 1 ? 's' : ''} selected
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedItems(new Set())}
                >
                  Clear Selection
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDeleteClick('bulk')}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Language families tree */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Language Families & Languages
          </CardTitle>
          <CardDescription>
            Manage your language families and languages. Select items for bulk operations or delete individually.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {families.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No language families found. Import some data to get started.
            </div>
          ) : (
            <div className="space-y-1">
              {families.map(family => renderFamily(family))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'family' && (
                <>Are you sure you want to delete the language family "{deleteTarget.name}"? This will also delete all child families and languages.</>
              )}
              {deleteTarget?.type === 'language' && (
                <>Are you sure you want to delete the language "{deleteTarget.name}"?</>
              )}
              {deleteTarget?.type === 'bulk' && (
                <>Are you sure you want to delete the selected {selectedItems.size} items?</>
              )}
              
              {deletePreview && (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <p className="font-medium mb-2">This will permanently delete:</p>
                  <ul className="text-sm space-y-1">
                    {deletePreview.families > 0 && <li>• {deletePreview.families} language families</li>}
                    {deletePreview.languages > 0 && <li>• {deletePreview.languages} languages</li>}
                    {deletePreview.translations > 0 && <li>• ~{deletePreview.translations} word translations</li>}
                    {deletePreview.jobs > 0 && <li>• ~{deletePreview.jobs} scraping jobs</li>}
                  </ul>
                </div>
              )}
              
              <p className="mt-4 text-destructive font-medium">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
