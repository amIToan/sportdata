// Capture the rendered bracket so PDF content cannot drift from the visible tree.
export async function exportBracketPdf(board: HTMLElement, heading: HTMLElement, filename: string) {
  const [{ toPng }, { default: pdfMake }] = await Promise.all([
    import('html-to-image'),
    import('pdfmake/build/pdfmake'),
  ]);
  await document.fonts.ready;
  await Promise.all(Array.from(board.querySelectorAll('img')).map((image) => image.decode().catch(() => undefined)));

  const width = board.offsetWidth;
  const height = board.offsetHeight + 56;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;';
  const snapshot = document.createElement('div');
  snapshot.style.cssText = `width:${width}px;height:${height}px;background:#111420;color:white;`;
  const title = document.createElement('div');
  title.className = 'sportdata-draw-title';
  title.style.cssText = 'height:56px;';
  title.appendChild(heading.cloneNode(true));
  const tree = board.cloneNode(true) as HTMLElement;
  tree.style.transform = 'none';
  snapshot.append(title, tree);
  host.appendChild(snapshot);
  document.body.appendChild(host);
  try {
    // html-to-image clones SVG descendants without their stylesheet rules.
    for (const element of Array.from(tree.querySelectorAll<SVGElement>('svg *'))) {
      const style = getComputedStyle(element);
      for (const property of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'vector-effect', 'color']) {
        element.style.setProperty(property, style.getPropertyValue(property));
      }
    }
    const image = await toPng(snapshot, {
      width, height,
      // Bound canvas dimensions and memory for large brackets, while retaining the entire tree.
      pixelRatio: Math.min(2, 16000 / Math.max(width, height), Math.sqrt(24000000 / (width * height))),
    });
    const scale = Math.min(0.75, 14000 / Math.max(width, height));
    await pdfMake.createPdf({
      pageSize: { width: width * scale, height: height * scale },
      pageMargins: 0,
      content: [{ image, width: width * scale, height: height * scale }],
    }).download(filename);
  } finally {
    host.remove();
  }
}
