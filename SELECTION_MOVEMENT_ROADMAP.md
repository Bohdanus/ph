# Next Steps: Selection Interaction & Movement

## Overview
Once polygons are created and stored as selections, users need to be able to interact with them (move, transform, apply effects to them). This document outlines the recommended implementation approach.

## Recommended Architecture

### 1. Selection Manipulation Tool (Next Priority)
Create a new `SelectionToolArea.tsx` component that:
- Detects when user clicks on an active selection
- Shows transform handles (move, resize, rotate)
- Updates the selection's `pos` when moved
- Stores changes to the selection

### 2. Hook: `useSelection()`
Create a custom hook to manage selection operations:

```typescript
// src/contexts/useSelection.ts
export const useSelection = () => {
  const [{ selections }, dispatch] = useStore();
  
  const updateSelection = (id: string, updates: Partial<Selection>) => {
    return dispatch({
      type: 'SET_SELECTIONS',
      payload: selections.map(s => s.id === id ? {...s, ...updates} : s)
    });
  };
  
  const deleteSelection = (id: string) => {
    dispatch({
      type: 'SET_SELECTIONS',
      payload: selections.filter(s => s.id !== id)
    });
  };
  
  const setActiveSelection = (id: string) => {
    // Deactivate others, activate this one
    dispatch({
      type: 'SET_SELECTIONS',
      payload: selections.map(s => ({...s, isActive: s.id === id}))
    });
  };
  
  return {
    selections,
    updateSelection,
    deleteSelection,
    setActiveSelection,
    activeSelection: selections.find(s => s.isActive) ?? null,
  };
};
```

### 3. Rendering Selections (Visual Feedback)
Update `Main.tsx` to render active selections on the overlay canvas:

```typescript
// In DrawAllLayers or a separate effect
useEffect(() => {
  const ctx = toolCtxRef.current;
  if (!ctx) return;
  
  selections.forEach(selection => {
    if (!selection.isActive) return;
    
    // Draw marching ants or static outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    
    ctx.beginPath();
    ctx.moveTo(selection.points[0].x + selection.pos.x, selection.points[0].y + selection.pos.y);
    for (let i = 1; i < selection.points.length; i++) {
      ctx.lineTo(
        selection.points[i].x + selection.pos.x, 
        selection.points[i].y + selection.pos.y
      );
    }
    ctx.closePath();
    ctx.stroke();
  });
}, [selections]);
```

## Implementation Phases

### Phase 1: Basic Selection Rendering (1-2 hours)
- [ ] Add selection rendering to Main component
- [ ] Show marching ants animation
- [ ] Display selection bounds and handles
- [ ] Add `useSelection` hook

### Phase 2: Selection Movement (2-3 hours)
- [ ] Create `SelectionToolArea.tsx`
- [ ] Implement drag-to-move for selections
- [ ] Display move cursor on selection hover
- [ ] Update `selections` state when moved

### Phase 3: Transform Operations (3-4 hours)
- [ ] Add resize handles at corners and edges
- [ ] Implement corner drag for resize
- [ ] Add rotation handle
- [ ] Update selection dimensions

### Phase 4: Selection Output (2-3 hours)
- [ ] Apply selection to a new layer
- [ ] Delete/cut inside selection
- [ ] Fill selection with color
- [ ] Stroke selection outline

## UI/UX Considerations

### Cursor Feedback
```typescript
const getCursorForHandle = (handle: 'move' | 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'rotate') => {
  const cursors = {
    move: 'move',
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
    sw: 'nesw-resize',
    rotate: 'grab',
  };
  return cursors[handle] ?? 'default';
};
```

### Visual Feedback
- Show transform handles on active selection
- Highlight hovered handle
- Show temporary outline while dragging
- Snap to grid options (future)
- Preview mode for transformations

## Code Examples

### Selection Moving Implementation

```typescript
// src/components/Main/SelectionToolArea.tsx
const SelectionToolArea = ({ overlayCtxRef }: Props) => {
  const [{ container, total Size }, dispatch] = useStore();
  const { activeSelection, updateSelection } = useSelection();
  const dragStateRef = useRef<{
    originalPos: Pos;
    currentHandle: string;
  } | null>(null);

  const handlePointerDown = (e: PointerEvent) => {
    if (!activeSelection) return;
    
    // Check which handle was clicked
    const handle = getClickedHandle(e, activeSelection);
    if (handle) {
      dragStateRef.current = {
        originalPos: activeSelection.pos,
        currentHandle: handle,
      };
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!dragStateRef.current) return;
    
    const delta = { dx: e.movementX, dy: e.movementY };
    const newPos = updatePositionFromHandle(
      dragStateRef.current.originalPos,
      delta,
      dragStateRef.current.currentHandle
    );
    
    updateSelection(activeSelection!.id, { pos: newPos });
  };

  const handlePointerUp = () => {
    dragStateRef.current = null;
  };

  // Render handles
  // ...
};
```

## Testing Strategy

### Unit Tests
- [ ] useSelection hook
- [ ] Selection update/delete/setActive functions
- [ ] Bounding box calculations

### Integration Tests
- [ ] Create selection → see it rendered
- [ ] Move selection → pos updates
- [ ] Deselect/select → visual feedback
- [ ] Multiple selections → correct rendering

### Manual Testing
- [ ] UI responsiveness
- [ ] Handle dragging smoothness
- [ ] Keyboard shortcuts (delete, escape)
- [ ] Selection persistence across tool changes

## Future Features

1. **Keys for Selection Management**
   - `Delete` - Delete active selection
   - `Escape` - Deselect all
   - `Ctrl+D` - Deselect
   - `Ctrl+I` - Invert
   - `Ctrl+A` - Select all

2. **Selection Modes**
   - Add to selection (Shift+drag in polygon tool)
   - Subtract from selection (Alt+drag)
   - Intersect with selection (Shift+Alt+drag)
   - Replace selection (normal mode)

3. **Advanced Operations**
   - Apply filters only inside selection
   - Grow/Shrink selection
   - Smooth/Feather selection edges
   - Border/Outline selection

4. **Animation**
   - Marching ants animation (dashed line animation)
   - Smooth transitions when transforming
   - Preview while dragging

## Configuration

### User Preferences (Store in localStorage)
```typescript
{
  selection: {
    showMarching Ants: true,
    marchingAntsSpeed: 2, // pixels per frame
    showTransformHandles: true,
    snapToGrid: false,
    gridSize: 10,
  }
}
```

## References

### Similar Implementations
- Photoshop's selections (marquee tool)
- GIMP's Free Select / Fuzzy Select
- Figma's selection handling
- Pixlr's lasso selection

### Performance Considerations
- Render selections on a separate canvas layer
- Use requestAnimationFrame for smooth animations
- Optimize point rendering for large polygons (simplify path)
- Cache transformed points when possible

## Success Criteria

- Users can select polygonal areas
- Selected areas can be moved/transformed
- Visual feedback is clear and responsive
- Performance remains smooth with complex selections
- Selections persist when switching tools
- Multiple selections work correctly

