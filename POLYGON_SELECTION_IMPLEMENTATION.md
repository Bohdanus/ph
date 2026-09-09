# Polygon Selection Tool Implementation

## Overview
Implemented a Photoshop-style polygon selection tool that allows users to create selections by clicking points to form polygonal shapes.

## Key Features

### 1. **Workflow** (Photoshop-Compatible)
- **Click to Place Points**: Left-click places anchor points
- **Visual Feedback**:
    - Lines connect points as you place them
    - Dashed guide line shows closing path from last point to first
    - Point markers indicate anchor locations
    - First point is highlighted with a white circle
- **Finish Selection**:
    - **Right-click**: Automatically finishes and closes the polygon
    - **Double-click first point**: Closes the polygon
    - Minimum 3 points required to create a valid selection

### 2. **Advanced Modes**
- **Shift + Drag**: Switch to continuous freehand drawing mode (like traditional lasso)
    - Once you start shift+dragging, the tool enters continuous mode
    - Click points are disabled in continuous mode
    - Complete the selection with right-click as normal

### 3. **Selection Storage**
- Selections are stored in global state (`StoreContext`)
- Each selection contains:
    - `id`: Unique identifier
    - `points`: Array of Point coordinates (relative to selection bounds)
    - `isActive`: Boolean flag for active selection
    - `pos`: Position and dimensions of the selection bounding box
- Supports multiple selections for future extensions

### 4. **Toolbar Options**
- **Mode Toggle**: Switch between "Outline" and "Fill" modes
- **Line Width**: Control stroke width (1-100px, default 3px)
- **Opacity**: Control selection visibility (0-100%, default 100%)
- **Color**: Inherits from global color selector
- Visual help text showing keyboard shortcuts

## Files Modified

### Core State Management
- **`src/contexts/general-types.ts`**
    - Added `Selection` type with points, position, and active state

- **`src/contexts/StoreContext.tsx`**
    - Added `selections: Selection[]` to `StoreData`
    - Added action types: `SET_SELECTIONS`, `ADD_SELECTION`, `CLEAR_SELECTIONS`
    - Implemented reducer cases for selection management

### Tool Implementation
- **`src/tools/polygonSelection.ts`**
    - Fixed the tool to properly render polygons with stroke/fill
    - Added proper property destructuring (color, lineWidth, alpha, fill)
    - Tool name remains `'lasso'` for backward compatibility

- **`src/components/Main/PolygonClickToolArea.tsx`** (Completely Refactored)
    - Removed continuous drawing by default (uses click-to-place)
    - Added left-click handling for placing points
    - Added right-click handling for finishing selection
    - Added double-click detection on first point
    - Added shift+drag for continuous drawing mode
    - Visual rendering of points, lines, and guides
    - Selection creation and dispatch to store

### UI Updates
- **`src/tools/settings.ts`**
    - Added default settings for lasso tool with new properties:
        - `alpha: 1`
        - `lineWidth: 3`
        - `color: '#FF0000'`
        - `fill: false`

- **`src/components/ToolbarsRight/Lasso/Lasso.tsx`**
    - Updated to include all tool properties (color, lineWidth, alpha, fill)
    - Added fill toggle button
    - Updated help text with keyboard shortcuts

## Type Definitions

```typescript
export type Selection = {
  id: string;                    // Unique identifier
  points: Point[];               // Points relative to bounds
  isActive: boolean;             // Selection state
  pos: Pos;                      // Bounding box position
};

export type LassoToolArgs = {
  points?: Point[];
  color: string;                 // Selection outline color
  lineWidth: number;             // Stroke width
  alpha: number;                 // Opacity (0-1)
  fill: boolean;                 // Fill vs outline mode
  toolName: 'lasso';
};
```

## Usage Instructions

### Basic Polygon Selection
1. Select the Polygon Selection tool from toolbar
2. Click on the image to place the first point
3. Continue clicking to add more points (minimum 3)
4. A dashed line shows where the polygon will close
5. Either:
    - Right-click anywhere to finish
    - Double-click on the first point to close the loop
6. Selection is created and stored

### Freehand Drawing
1. Place at least one point with regular click
2. Hold Shift and drag to draw freehand
3. Release Shift to return to point-placement mode
4. Right-click to finish

### Settings
- Toggle between **Outline** and **Fill** modes
- Adjust line width (affects visual feedback)
- Control opacity for better visibility
- Color matches your current brush color

## State Management

Selections are managed in the global store:
```typescript
dispatch({ type: 'ADD_SELECTION', payload: selection })
dispatch({ type: 'SET_SELECTIONS', payload: selectionsArray })
dispatch({ type: 'CLEAR_SELECTIONS' })
```

## Future Enhancements

These features are ready for implementation:

1. **Selection Movement & Transformation**
    - Add a "Move Selection" tool to reposition selections
    - Transform tool support (rotate, scale, skew)
    - Marching ants animation effect

2. **Selection Operations**
    - Add, subtract, intersect, exclude selection modes
    - Invert selection
    - Select all / deselect all

3. **Selection Effects**
    - Feather edges
    - Anti-aliasing options
    - Save/load selections

4. **Visualization**
    - Show marching ants animation on active selections
    - Highlight active selection bounds

## Testing Checklist

- [x] Click-to-place workflow works
- [x] Right-click finishes selection
- [x] Double-click on first point closes polygon
- [x] Visual feedback (lines, points, guides) renders correctly
- [x] Shift+drag enables freehand mode
- [x] Outline/Fill toggle works
- [x] Line width adjustment works
- [x] Opacity adjustment works
- [x] Selections are stored in global state
- [x] Build completes successfully with no errors

## Notes

- The tool name `'lasso'` is maintained for backward compatibility with existing component names
- The selection is relative to its bounding box to optimize memory usage
- The `color` property comes from the global store and updates automatically when the brush color changes
- Multiple selections are supported but currently not displayed/managed in the UI (ready for future UI enhancement)

