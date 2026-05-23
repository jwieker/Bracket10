/**
 * adminMiddleware.js
 * Admin route protection middleware.
 * requireSiteAdmin is the primary guard (session-based).
 */

export const requireSiteAdmin = (req, res, next) => {
    if (!req.session?.siteAdmin) {
        if (req.headers?.accept?.includes('application/json') || req.method === 'POST') {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        return res.redirect('/updates');
    }
    next();
};
