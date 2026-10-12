import { describe, expect, it } from 'vitest';

import { createMockCanvasContext as createFixtureContext } from './canvas.ts';
import { createMockCanvasContext as createSetupContext } from '../../test/setup.ts';

describe('canvas fixture contract: both createMockCanvasContext exports share the same base API', () => {
  const fixtureCtx = createFixtureContext();
  const setupCtx = createSetupContext();

  it('both provide filter as a writable data property (not a getter)', () => {
    const fixtureDesc = Object.getOwnPropertyDescriptor(fixtureCtx, 'filter');
    const setupDesc = Object.getOwnPropertyDescriptor(setupCtx, 'filter');

    expect(fixtureDesc).toBeDefined();
    expect(setupDesc).toBeDefined();
    expect(fixtureDesc?.get).toBeUndefined();
    expect(setupDesc?.get).toBeUndefined();
    expect(fixtureDesc?.set).toBeUndefined();
    expect(setupDesc?.set).toBeUndefined();
    expect(fixtureDesc?.writable).toBe(true);
    expect(setupDesc?.writable).toBe(true);
  });

  it('both provide createPattern method', () => {
    expect(typeof fixtureCtx.createPattern).toBe('function');
    expect(typeof setupCtx.createPattern).toBe('function');
  });

  it('both provide the same core CanvasRenderingContext2D methods', () => {
    const coreMethods = [
      'clearRect',
      'beginPath',
      'closePath',
      'moveTo',
      'lineTo',
      'bezierCurveTo',
      'quadraticCurveTo',
      'rect',
      'roundRect',
      'arcTo',
      'stroke',
      'fill',
      'fillRect',
      'strokeRect',
      'fillText',
      'strokeText',
      'measureText',
      'arc',
      'ellipse',
      'save',
      'restore',
      'reset',
      'setLineDash',
      'getLineDash',
      'drawImage',
      'clip',
      'isPointInPath',
      'isPointInStroke',
      'createRadialGradient',
      'createLinearGradient',
      'createConicGradient',
      'translate',
      'rotate',
      'scale',
      'transform',
      'setTransform',
      'resetTransform',
    ];

    for (const method of coreMethods) {
      expect(typeof (fixtureCtx as unknown as Record<string, unknown>)[method]).toBe('function');
      expect(typeof (setupCtx as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('both provide the same core CanvasRenderingContext2D properties', () => {
    const coreProperties = [
      'strokeStyle',
      'fillStyle',
      'lineWidth',
      'lineCap',
      'lineJoin',
      'miterLimit',
      'font',
      'textAlign',
      'textBaseline',
      'direction',
      'imageSmoothingEnabled',
      'shadowBlur',
      'shadowColor',
      'shadowOffsetX',
      'shadowOffsetY',
      'globalAlpha',
      'globalCompositeOperation',
    ];

    for (const prop of coreProperties) {
      expect(prop in fixtureCtx).toBe(true);
      expect(prop in setupCtx).toBe(true);
    }
  });

  it('filter writes are observable on both contexts', () => {
    fixtureCtx.filter = 'blur(4px)';
    setupCtx.filter = 'blur(4px)';

    expect(fixtureCtx.filter).toBe('blur(4px)');
    expect(setupCtx.filter).toBe('blur(4px)');
  });

  it('createPattern returns a mock pattern on both contexts', () => {
    const fixturePattern = (fixtureCtx as unknown as CanvasRenderingContext2D).createPattern(
      {} as CanvasImageSource,
      'repeat'
    );
    const setupPattern = setupCtx.createPattern({} as CanvasImageSource, 'repeat');

    expect(fixturePattern).toBeNull();
    expect(setupPattern).toBeNull();
  });
});
