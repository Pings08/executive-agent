/**
 * CEO-defined objective categories per org.
 * Objectives are auto-classified into these categories by keyword matching.
 */

export interface OrgCategory {
  id: string;
  label: string;
  color: string;       // tailwind color class
  bgColor: string;     // light background
  borderColor: string;
  keywords: string[];   // lowercase keywords for auto-matching
}

export const BIOTECH_CATEGORIES: OrgCategory[] = [
  {
    id: 'regulatory',
    label: 'Regulatory',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    keywords: ['regulatory', 'gmp', 'compliance', 'calibration', 'documentation', 'instrument', 'production lab', 'quality', 'audit'],
  },
  {
    id: 'discovery',
    label: 'Discovery',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
    keywords: ['discovery', 'agro', 'agriculture', 'mechanism of action', 'rna regulation', 'cross-kingdom', 'g-quadruplex', 'sponge', 'universal', 'gene identification', 'gene filtering', 'target gene', 'formulation'],
  },
  {
    id: 'preclinical',
    label: 'Preclinical',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    keywords: ['preclinical', 'immunotoxicity', 'toxicity', 'biodistribution', 'in vivo', 'animal study', 'clinical'],
  },
  {
    id: 'aso',
    label: 'ASO',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    keywords: ['aso', 'antisense', 'oligonucleotide', 'primer design', 'primer validation', 'tm calculation', 'off-target', 'd1 modification'],
  },
  {
    id: 'patent',
    label: 'Patent',
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
    keywords: ['patent', 'ip', 'intellectual property', 'searchability', 'exrp250', 'prior art', 'filing'],
  },
];

export const TCR_CATEGORIES: OrgCategory[] = [
  { id: 'hardware', label: 'Hardware', color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30', keywords: ['hardware', 'pcb', 'mechanical', 'electrode', 'sensor', 'pogo'] },
  { id: 'software', label: 'Software', color: 'text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/30', keywords: ['software', 'firmware', 'app', 'api', 'platform', 'code'] },
  { id: 'operations', label: 'Operations', color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30', keywords: ['operations', 'hr', 'onboarding', 'accounts', 'iso', 'qms'] },
  { id: 'product', label: 'Product', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30', keywords: ['product', 'tempeq', 'pwomise', 'design', 'prototype'] },
];

export const SENTIENT_CATEGORIES: OrgCategory[] = [
  { id: 'robotics', label: 'Robotics', color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30', keywords: ['robot', 'humanoid', 'arm', 'actuator', 'motor'] },
  { id: 'platform', label: 'Platform', color: 'text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/30', keywords: ['platform', 'software', 'pilot', 'pod', 'telus'] },
  { id: 'research', label: 'Research', color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30', keywords: ['research', 'egocentric', 'vision', 'ai', 'model'] },
];

export const ORG_CATEGORIES: Record<string, OrgCategory[]> = {
  biotech: BIOTECH_CATEGORIES,
  tcr: TCR_CATEGORIES,
  sentient_x: SENTIENT_CATEGORIES,
};

/**
 * Auto-classify an objective into a category by matching title + description against keywords.
 */
export function classifyObjective(
  title: string,
  description: string,
  categories: OrgCategory[]
): string {
  const text = `${title} ${description}`.toLowerCase();

  let bestMatch = { id: 'uncategorized', score: 0 };

  for (const cat of categories) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (text.includes(kw)) score += kw.length; // longer keyword matches = higher confidence
    }
    if (score > bestMatch.score) {
      bestMatch = { id: cat.id, score };
    }
  }

  return bestMatch.id;
}

/**
 * Classify all objectives and group by category.
 */
export function groupByCategory<T extends { title: string; description?: string }>(
  objectives: T[],
  categories: OrgCategory[]
): Map<string, { category: OrgCategory; objectives: T[] }> {
  const groups = new Map<string, { category: OrgCategory; objectives: T[] }>();

  for (const cat of categories) {
    groups.set(cat.id, { category: cat, objectives: [] });
  }
  groups.set('uncategorized', {
    category: { id: 'uncategorized', label: 'Other', color: 'text-gray-400', bgColor: 'bg-gray-500/10', borderColor: 'border-gray-500/30', keywords: [] },
    objectives: [],
  });

  for (const obj of objectives) {
    const catId = classifyObjective(obj.title, obj.description || '', categories);
    groups.get(catId)!.objectives.push(obj);
  }

  return groups;
}
