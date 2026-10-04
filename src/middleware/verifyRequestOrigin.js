// Anonymous verification cannot mint a session token without a Firestore write.
// Reject browser-forged submissions before they consume the entry's budget.
export function verifyRequestOrigin(req, res, next) {
  const origin = req.get('Origin');
  const source = origin === undefined ? req.get('Referer') : origin;
  try {
    const target = new URL(
      process.env.APP_HOST
        ? `https://${process.env.APP_HOST}`
        : `${req.protocol}://${req.get('Host')}`,
    );
    const sourceUrl = new URL(source);
    if (
      ['http:', 'https:'].includes(sourceUrl.protocol) &&
      sourceUrl.origin === target.origin &&
      !sourceUrl.username &&
      !sourceUrl.password &&
      (origin === undefined || origin === sourceUrl.origin)
    ) {
      return next();
    }
  } catch {
    // Missing, opaque, or malformed origins fail closed.
  }
  return res.status(403).send('Open the entry lookup page and try again.');
}
