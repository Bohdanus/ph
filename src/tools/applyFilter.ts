let scheduledRAF: number | null = null;

export const applyFilter = async (canvas: HTMLCanvasElement, action: (ctx: CanvasRenderingContext2D) => void) => {
  if (scheduledRAF !== null) {
    cancelAnimationFrame(scheduledRAF);
  }

  scheduledRAF = requestAnimationFrame(() => {
    scheduledRAF = null;

    const ctx = canvas.getContext('2d');
    ctx!.reset();

    action(ctx!);
  });
};
