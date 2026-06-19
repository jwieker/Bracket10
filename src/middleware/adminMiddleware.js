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

/**
 * requireUser — guard for the participant ("My Brackets") flow.
 * Checks ONLY req.session.userEmail; it never inspects siteAdmin, so a
 * participant session grants zero admin access (and vice versa). Unauthenticated
 * visitors are sent to the landing page, which hosts the Google sign-in button.
 */
export const requireUser = (req, res, next) => {
    if (!req.session?.userEmail) {
        // The participant POSTs (/my-brackets/update, /user/logout) are plain
        // HTML form submits, so only answer with JSON for explicit JSON clients;
        // browsers get redirected to the sign-in landing page.
        if (req.headers?.accept?.includes('application/json')) {
            return res.status(401).json({ error: 'Please sign in.' });
        }
        return res.redirect('/');
    }
    next();
};
