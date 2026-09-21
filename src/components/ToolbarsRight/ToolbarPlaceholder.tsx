import type { ReactNode } from 'react';

export type PlaceholderToolProps = {
  title: string;
  options: readonly string[];
  description?: string;
  showTodoBadge?: boolean;
};

export const PlaceholderTool = ({
  title,
  options,
  description = 'TODO: tool behavior not implemented yet.',
  showTodoBadge = true,
}: PlaceholderToolProps) => {
  return (
    <div className="flex min-w-[260px] flex-col gap-2 rounded-md border border-dashed border-amber-400 bg-amber-50/80 px-3 py-2 text-left text-xs text-slate-700 shadow-sm dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-slate-200">
      <div className="flex items-center justify-between gap-2">
        {showTodoBadge && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-700 dark:text-amber-300">
            TODO
          </span>
        )}
        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-300">{title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((option) => (
          <span
            key={option}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            {option}
          </span>
        ))}
      </div>
      <div className="text-[11px] text-slate-600 dark:text-slate-300">{description}</div>
    </div>
  );
};

export const placeholderToolGroups: Record<string, readonly string[]> = {
  brush: ['Brush Preset Picker', 'Blend Mode', 'Opacity', 'Flow', 'Airbrush', 'Smoothing', 'Symmetry'],
  pencil: ['Brush Preset Picker', 'Blend Mode', 'Opacity', 'Auto Erase', 'Smoothing', 'Symmetry'],
  'color-replacement': ['Brush Preset Picker', 'Blend Mode', 'Sampling', 'Limits', 'Tolerance', 'Anti-alias'],
  pen: ['Tool Mode', 'Fill', 'Stroke', 'Make Selection', 'Path Operations', 'Alignment', 'Auto Add/Delete'],
  'freeform-pen': ['Tool Mode', 'Fill', 'Stroke', 'Magnetic', 'Curve Fit'],
  'curvature-pen': ['Tool Mode', 'Fill', 'Stroke', 'Magnetic', 'Curve Fit'],
  rectangle: [
    'Tool Mode',
    'Fill',
    'Stroke',
    'Stroke Width',
    'Stroke Style',
    'W/H',
    'Path Operations',
    'Alignment',
    'Radius',
  ],
  'custom-shape': ['Tool Mode', 'Fill', 'Stroke', 'W/H', 'Shape Picker', 'Path Operations'],
};

export const placeholderToolMessage = (title: string): ReactNode => (
  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">TODO: {title} placeholder</span>
);
