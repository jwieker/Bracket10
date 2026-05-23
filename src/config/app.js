// Centralized application configuration
export const APP_CONFIG = {
    // Database
    database: {
        engine: 'firestore',
    },

    // Tournament
    tournament: {
        currentYear: (process.env.NODE_ENV === "test") ? 2027 : 2026,
        //currentYear: (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") ? 2021 : new Date().getFullYear(),
        maxEntriesPerGroup: 100,
        maxPicksPerEntry: 10,
        defaultGroup: process.env.DEFAULT_GROUP || "Default",
        chunkSize: 100,
        // Group whose unsent entries get drafted into emails by emailService.getUnsentEmailEntries.
        // Leave empty to disable the email-drafting helper.
        emailGroup: process.env.EMAIL_GROUP || "",
        // Group names that are filtered out of standard listings (legacy / sandbox).
        // Defaults to ["Bad"] — a conventional sandbox-group name used by this app.
        excludedGroups: process.env.EXCLUDED_GROUPS
            ? process.env.EXCLUDED_GROUPS.split(",").map(s => s.trim()).filter(Boolean)
            : ["Bad"],
        // Groups that get pinned to the top of group pickers.
        priorityGroups: (process.env.PRIORITY_GROUPS || "").split(",").map(s => s.trim()).filter(Boolean),
        // Group whose confirmation page renders a payment-collector block.
        // Leave empty to never render the collector block.
        paymentCollectorGroup: process.env.PAYMENT_COLLECTOR_GROUP || "",
    },

    // Payment-collector contact details rendered on the confirmation page
    // when an entry joins `tournament.paymentCollectorGroup`. All fields
    // optional — empty values hide their row in the UI.
    payments: {
        collectorName: process.env.PAYMENT_COLLECTOR_NAME || "",
        collectorEmail: process.env.PAYMENT_COLLECTOR_EMAIL || "",
        collectorPhone: process.env.PAYMENT_COLLECTOR_PHONE || "",
    },

    // Performance
    performance: {
        batchSize: 100,
        maxRetries: 5,
        retryDelay: 1000,
    },

    // Validation
    validation: {
        minTeamId: 1,
        maxTeamId: 9999999999,
        minPoints: 0,
        maxPoints: 1000,
    },

    // Logging
    logging: {
        enabled: process.env.NODE_ENV === 'development',
        level: process.env.LOG_LEVEL || 'info',
    }
};

// Re-export TOURNAMENT_ROUNDS for backward compatibility
export { TOURNAMENT_ROUNDS } from './const.js';

// Backward-compatible named exports used by services
export const thisYear = APP_CONFIG.tournament.currentYear;

// Tournament window dates (Eastern Time)
export const bracketLaunchDate = new Date("2026-03-15T19:00:00-04:00");
export const tourneyStartDate = new Date("2026-03-19T12:00:00-04:00");

// First Four window dates (Eastern Time)
export const firstFourStartDate = new Date("2026-03-17T18:00:00-04:00");
export const firstFourEndDate = new Date("2026-03-18T23:59:00-04:00");

// Returns true if registration is currently open (or we're in a dev/test environment)
export function isRegistrationOpen() {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return true;
    const now = new Date();
    return now > bracketLaunchDate && now <= tourneyStartDate;
}

export function isFirstFourActive() {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return false;
    const now = new Date();
    return now >= firstFourStartDate && now <= firstFourEndDate;
}
