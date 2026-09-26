// Width descriptors describe the encoded image, including portrait and small sources.
export function imageSources(url, work, max) {
  const bound = work.width && work.height ? Math.round(work.width * Math.min(1, max / work.width, max / work.height)) : max;
  return [...[480, 960].filter(width => width < bound).map(width => `${url}?w=${width} ${width}w`), `${url} ${bound}w`].join(', ');
}
