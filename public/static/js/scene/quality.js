/** Device tiering – picks particle counts, pixel ratio and geometry detail. */
export function getQuality() {
  const mobile = matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const dpr = window.devicePixelRatio || 1;

  let tier;
  if (mobile) tier = (cores <= 4 || mem <= 3) ? 'low' : 'mid';
  else tier = (cores <= 4 || mem <= 4) ? 'mid' : 'high';

  const T = {
    low:  { particles: 3500,  dprMax: 1, antialias: false },
    mid:  { particles: mobile ? 6000 : 14000, dprMax: mobile ? 1.25 : 1.5, antialias: !mobile },
    high: { particles: 22000, dprMax: 1.75, antialias: true },
  }[tier];

  return {
    tier, mobile,
    ...T,
    dpr: Math.min(dpr, T.dprMax),
    scrub: mobile ? 0.6 : 1.0,
    pointer: !mobile,
  };
}
