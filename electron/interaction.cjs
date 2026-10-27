// Native screen coordinates decide click-through. This does not depend on
// Chromium receiving forwarded pointer events while the window ignores input.
function isPetRegion(point, bounds,characterType='human') {
  if (!point || !bounds.width || !bounds.height) return false;
  const x = (point.x - bounds.x) / bounds.width;
  const y = (point.y - bounds.y) / bounds.height;
  const head = ((x - .5) / .32) ** 2 + ((y - .30) / .25) ** 2 <= 1;
  const body = x >= .20 && x <= .80 && y >= .38 && y <= .84;
  const feet = x >= .26 && x <= .74 && y >= .78 && y <= .94;
  const ears=characterType==='rabbit'?([.39,.61].some(center=>((x-center)/.10)**2+((y-.11)/.10)**2<=1)):characterType==='cat'?([.31,.69].some(center=>((x-center)/.12)**2+((y-.18)/.10)**2<=1)):false;
  const custom=characterType==='custom'&&x>=.22&&x<=.78&&y>=.05&&y<=.94;
  return head || body || feet || ears || custom;
}
module.exports = { isPetRegion };
