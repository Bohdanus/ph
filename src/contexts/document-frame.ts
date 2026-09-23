import type { Point, Pos, Size } from './general-types.ts';

export type DocumentFrame = Readonly<Pos>;

export function documentFrameFromSize(size: Size | undefined): DocumentFrame {
  return { x: 0, y: 0, width: size?.width ?? 0, height: size?.height ?? 0 };
}

export function documentFrameSize(frame: DocumentFrame): Size {
  return {
    width: Math.max(1, Math.ceil(frame.width)),
    height: Math.max(1, Math.ceil(frame.height)),
  };
}

export function isValidDocumentFrame(frame: unknown): frame is DocumentFrame {
  if (!frame || typeof frame !== 'object') return false;
  const candidate = frame as Partial<Pos>;
  return (
    [candidate.x, candidate.y, candidate.width, candidate.height].every(
      (value) => typeof value === 'number' && Number.isFinite(value)
    ) &&
    candidate.width! > 0 &&
    candidate.height! > 0
  );
}

export function cloneDocumentFrame(frame: DocumentFrame): DocumentFrame {
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}

export function canvasToDocumentPoint(point: Point, frame: DocumentFrame): Point {
  return { x: point.x + frame.x, y: point.y + frame.y };
}

export function documentToCanvasPoint(point: Point, frame: DocumentFrame): Point {
  return { x: point.x - frame.x, y: point.y - frame.y };
}

export function documentToCanvasPos(pos: Pos, frame: DocumentFrame): Pos {
  return { ...pos, x: pos.x - frame.x, y: pos.y - frame.y };
}

export function canvasToDocumentPos(pos: Pos, frame: DocumentFrame): Pos {
  return { ...pos, x: pos.x + frame.x, y: pos.y + frame.y };
}

export function canvasRectToDocumentFrame(pos: Pos, frame: DocumentFrame): DocumentFrame {
  return {
    x: frame.x + pos.x,
    y: frame.y + pos.y,
    width: pos.width,
    height: pos.height,
  };
}

export function documentFrameEquals(left: DocumentFrame, right: DocumentFrame): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
