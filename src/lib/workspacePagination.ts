export type PageInterval = { start: number; end: number };

/** Break in the space between controls/rows instead of cutting a control across two pages. */
export function paginateWorkspace(total: number, height: number, blocks: PageInterval[]): PageInterval[] {
  if (height <= 0 || total <= 0) return [{ start: 0, end: Math.max(0, total) }];
  const protectedBlocks = blocks.filter(({ start, end }) => end > start && end - start <= height);
  const pages: PageInterval[] = [];
  let start = 0;
  while (start < total) {
    let end = Math.min(total, start + height);
    if (end < total) {
      // Overlapping rows in adjacent columns can move the boundary more than once.
      for (let pass = 0; pass <= protectedBlocks.length; pass += 1) {
        const crossing = protectedBlocks.filter((block) => block.start < end - 0.5 && block.end > end + 0.5);
        if (!crossing.length) break;
        const boundary = Math.min(...crossing.map((block) => block.start));
        if (boundary <= start + 1) break;
        end = boundary;
      }
    }
    pages.push({ start, end });
    start = end;
  }
  return pages;
}
