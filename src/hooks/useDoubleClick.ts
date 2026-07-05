import { type RefObject, useRef } from 'react';
import type { Point } from '../contexts/general-types.ts';

const DEFAULT_DISTANCE_THRESHOLD = 10;
const DEFAULT_TIME_THRESHOLD_MS = 300;
const DEFAULT_MIN_POINTS_FOR_DETECTION = 2;

type UseDoubleClickOptions = {
  distanceThreshold?: number;
  timeThresholdMs?: number;
  minPointsForDetection?: number;
};

export const useDoubleClick = (onDoubleClick: () => void, options: UseDoubleClickOptions = {}) => {
  const lastClickTimeRef = useRef(0);
  const lastClickPosRef = useRef<Point | null>(null);

  const {
    distanceThreshold = DEFAULT_DISTANCE_THRESHOLD,
    timeThresholdMs = DEFAULT_TIME_THRESHOLD_MS,
    minPointsForDetection = DEFAULT_MIN_POINTS_FOR_DETECTION,
  } = options;

  const isDoubleClick = (coords: Point, pointsRef: RefObject<Point[]>): boolean => {
    if (pointsRef.current?.length <= minPointsForDetection || !lastClickPosRef.current) {
      return false;
    }

    const dx = coords.x - lastClickPosRef.current.x;
    const dy = coords.y - lastClickPosRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const timeSinceLastClick = Date.now() - lastClickTimeRef.current;

    return distance < distanceThreshold && timeSinceLastClick < timeThresholdMs;
  };

  const handleClick = (coords: Point, pointsRef: RefObject<Point[]>): boolean => {
    if (isDoubleClick(coords, pointsRef)) {
      onDoubleClick();
      lastClickTimeRef.current = 0;
      lastClickPosRef.current = null;
      return true;
    }

    lastClickTimeRef.current = Date.now();
    lastClickPosRef.current = coords;
    return false;
  };

  const reset = () => {
    lastClickTimeRef.current = 0;
    lastClickPosRef.current = null;
  };

  return { handleClick, reset };
};
